
import atexit
import asyncio
import json
import sys
import os
import subprocess
import re

from dotenv import load_dotenv
from pathlib import Path

from importlib.metadata import PackageNotFoundError, version

from diagnostics import RunDiagnostics


import requests

from browser_use import Agent, Browser, ChatGoogle
project_root = Path(__file__).resolve().parent.parent

load_dotenv(Path(__file__).resolve().parent.parent / "app" / ".env")



api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise RuntimeError(
        "GOOGLE_API_KEY is missing. Check the project .env file."
    )


API_BASE_URL = "http://localhost:3001/api"

RUN_ID = None
current_step = 0

# ---------------------------------------------------------
# Run file paths
# ---------------------------------------------------------

RUN_DIR = None
HISTORY_FILE = None
LOG_FILE = None
DIAGNOSTICS_FILE = None

# Active diagnostics objects for the current application run.
_diagnostics = None
_diagnostics_agent = None


def setup_run_files(run_id: int):
    global RUN_DIR, HISTORY_FILE, LOG_FILE, DIAGNOSTICS_FILE

    # main.py lives in browser-use/ — write logs there too.
    base = Path(__file__).parent / "runs" / str(run_id)
    base.mkdir(parents=True, exist_ok=True)

    RUN_DIR = base
    HISTORY_FILE = base / "history.json"
    LOG_FILE = base / "run.log"
    DIAGNOSTICS_FILE = base / "diagnostics.json"


# ---------------------------------------------------------
# Tee stream — write to terminal AND log file simultaneously
# ---------------------------------------------------------

class TeeStream:
    """Wrap a stream so writes go to both the original stream and a log file."""

    def __init__(self, original, log_file):
        self._original = original
        self._log = log_file

    def write(self, data):
        self._original.write(data)
        try:
            self._log.write(data)
        except Exception:
            pass
        return len(data)

    def flush(self):
        self._original.flush()
        try:
            self._log.flush()
        except Exception:
            pass

    def fileno(self):
        return self._original.fileno()

    def isatty(self):
        return False

    def __getattr__(self, name):
        return getattr(self._original, name)


_log_file_handle = None
_original_stdout = None
_original_stderr = None


def start_console_logging():
    """
    Redirect sys.stdout / sys.stderr through a TeeStream so every print()
    call is written to both the terminal and runs/<runId>/run.log.
    """
    global _log_file_handle, _original_stdout, _original_stderr

    _log_file_handle = LOG_FILE.open("w", encoding="utf-8", buffering=1)

    _original_stdout = sys.stdout
    _original_stderr = sys.stderr

    sys.stdout = TeeStream(sys.stdout, _log_file_handle)
    sys.stderr = TeeStream(sys.stderr, _log_file_handle)


def stop_console_logging():
    """Restore sys.stdout / sys.stderr and close the log file."""
    global _log_file_handle, _original_stdout, _original_stderr

    if _original_stdout is not None:
        sys.stdout = _original_stdout
        _original_stdout = None

    if _original_stderr is not None:
        sys.stderr = _original_stderr
        _original_stderr = None

    if _log_file_handle is not None:
        try:
            _log_file_handle.flush()
            _log_file_handle.close()
        except Exception:
            pass

        _log_file_handle = None


# ---------------------------------------------------------
# Cancellation — guaranteed to run on any exit path
# ---------------------------------------------------------

_cancellation_done = False


def _cancel_on_exit():
    """
    Cancel the current application run.

    Called from:
      - atexit handler  (covers sys.exit() from Browser Use's own signal handler)
      - Browser Use's custom_exit_callback  (called just before it calls sys.exit())
      - our own except KeyboardInterrupt block (if asyncio sees it first)

    A flag prevents double-cancellation if more than one path fires.
    """
    global _cancellation_done

    if _cancellation_done:
        return
    _cancellation_done = True

    # Nothing to cancel if we never got past claim.
    if RUN_ID is None:
        return

    print("\n[cancel] Cancelling application run...", flush=True)

    try:
        cancel_application_run(
            log_file=str(LOG_FILE) if LOG_FILE else None,
            history_file=(
                str(HISTORY_FILE)
                if HISTORY_FILE and HISTORY_FILE.exists()
                else None
            ),
        )
        app_dir = Path(__file__).resolve().parent.parent / "app"
        if (app_dir / "package.json").exists():
            subprocess.run(
                ["npm", "run", "sync:notion:reverse"],
                cwd=str(app_dir),
                check=False,
            )
    except Exception as exc:
        print(f"[cancel] Failed to reach API or sync: {exc}", flush=True)

    # Save diagnostics for interrupted or cancelled runs.
    if _diagnostics is not None:
        try:
            _diagnostics.sync_finalize(
                agent=_diagnostics_agent,
                outcome="CANCELLED",
                error_message="Application run cancelled or interrupted.",
            )
        except Exception as exc:
            print(
                f"[diagnostics] Warning: Failed to finalise diagnostics: {exc}",
                flush=True,
            )

    stop_console_logging()


# Register as atexit handler — fires on any clean sys.exit(), including
# the one Browser Use calls from its own SIGINT handler.
atexit.register(_cancel_on_exit)


# ---------------------------------------------------------
# API helpers
# ---------------------------------------------------------

def claim_next_application():
    """
    Call POST /api/application-runs/claim.

    Returns the claimed application data on success.
    Prints a clear message and exits cleanly (code 0) when the queue is
    empty or no job has an application URL.
    Raises on unexpected errors.
    """
    response = requests.post(f"{API_BASE_URL}/application-runs/claim")

    if response.status_code == 422:
        data = response.json()
        reason = data.get("reason", "UNKNOWN")
        message = data.get("error", "Queue unavailable.")

        print()
        print("=" * 50)
        if reason == "NO_QUEUED_JOBS":
            print("  No queued applications")
            print()
            print("  No jobs have QUEUED status in SQLite.")
            print("  To queue a job:")
            print("    1. Open Notion and change a job's")
            print("       'Application status' to QUEUED.")
            print("    2. Run:  npm run apply")
        elif reason == "NO_APPLICATION_URL":
            print("  No application URL available")
            print()
            print(f"  {message}")
            print("  To fix this:")
            print("    Add an 'Application URL' to at least one")
            print("    QUEUED job in Notion and run:  npm run apply")
        else:
            print(f"  Cannot claim application: {message}")
        print("=" * 50)
        print()

        # Deregister the atexit cancel handler — nothing was claimed.
        atexit.unregister(_cancel_on_exit)
        sys.exit(0)

    response.raise_for_status()

    data = response.json()

    print("\n========== APPLICATION CLAIM ==========")
    print(f"  Run ID:  {data['runId']}")
    print(f"  Job ID:  {data['job']['id']}")
    print(f"  Title:   {data['job']['title']}")
    print(f"  Company: {data['job']['company']}")
    print("=======================================\n")

    return data


def start_application_run():
    response = requests.post(
        f"{API_BASE_URL}/application-runs/{RUN_ID}/start"
    )
    response.raise_for_status()
    data = response.json()
    print("\n========== APPLICATION RUN START ==========")
    print(data)
    print("===========================================\n")


async def report_step_start(agent):
    global current_step
    current_step += 1
    print(f"[progress] Browser Use STARTED step {current_step}")

        # Record the diagnostic step without disrupting application progress.
    if _diagnostics is not None:
        try:
            _diagnostics.on_step_start(agent, current_step)
        except Exception as exc:
            print(
                f"[diagnostics] Warning: Step-start recording failed: {exc}",
                flush=True,
            )

    response = requests.patch(
        f"{API_BASE_URL}/application-runs/{RUN_ID}/progress",
        json={
            "currentStep": current_step,
            "stepsCompleted": current_step - 1,
        },
    )
    response.raise_for_status()


async def report_step_end(agent):
    print(f"[progress] Browser Use COMPLETED step {current_step}")

    # Record diagnostic details for the completed step.
    if _diagnostics is not None:
        try:
            _diagnostics.on_step_end(agent, current_step)
        except Exception as exc:
            print(
                f"[diagnostics] Warning: Step-end recording failed: {exc}",
                flush=True,
            )

    response = requests.patch(
        f"{API_BASE_URL}/application-runs/{RUN_ID}/progress",
        json={
            "currentStep": current_step,
            "stepsCompleted": current_step,
        },
    )
    response.raise_for_status()


def complete_application_run(
    steps_completed: int,
    final_result: str,
    log_file: str | None,
    history_file: str | None,
):
    response = requests.post(
        f"{API_BASE_URL}/application-runs/{RUN_ID}/complete",
        json={
            "stepsCompleted": steps_completed,
            "finalResult": final_result,
            "logFile": log_file,
            "historyFile": history_file,
        },
    )
    response.raise_for_status()
    data = response.json()
    print("\n========== APPLICATION RUN COMPLETE ==========")
    print(data)
    print("===============================================\n")


def fail_application_run(
    error_message: str,
    log_file: str | None,
    history_file: str | None,
):
    response = requests.post(
        f"{API_BASE_URL}/application-runs/{RUN_ID}/fail",
        json={
            "errorMessage": error_message,
            "logFile": log_file,
            "historyFile": history_file,
        },
    )
    response.raise_for_status()
    data = response.json()
    print("\n========== APPLICATION RUN FAILED ==========")
    print(data)
    print("============================================\n")


def cancel_application_run(
    log_file: str | None,
    history_file: str | None,
):
    response = requests.post(
        f"{API_BASE_URL}/application-runs/{RUN_ID}/cancel",
        json={
            "logFile": log_file,
            "historyFile": history_file,
        },
    )
    response.raise_for_status()
    data = response.json()
    print("\n========== APPLICATION RUN CANCELLED ==========")
    print(data)
    print("===============================================\n")


# ---------------------------------------------------------
# Main
# ---------------------------------------------------------

async def main():
    global RUN_ID, _diagnostics, _diagnostics_agent

    claimed = claim_next_application()

    RUN_ID = claimed["runId"]
    job = claimed["job"]

    os.environ["EMPLOY_ME_RUN_ID"] = str(RUN_ID)

    setup_run_files(RUN_ID)
    start_console_logging()

        # -----------------------------------------------------
    # Diagnostics setup
    # -----------------------------------------------------

    try:
        try:
            browser_use_version = version("browser-use")
        except PackageNotFoundError:
            browser_use_version = "unknown"

        _diagnostics = RunDiagnostics(
            run_id=RUN_ID,
            model="gemini-3.8-flash",
            browser_use_version=browser_use_version,
            step_timeout=180,
            llm_timeout=900,
            run_dir=RUN_DIR,
            log_file=LOG_FILE,
            history_file=HISTORY_FILE,
            diagnostics_file=DIAGNOSTICS_FILE,
        )

        print(
            f"[diagnostics] Initialised for run {RUN_ID}",
            flush=True,
        )

    except Exception as exc:
        # Diagnostics must never prevent an application from running.
        _diagnostics = None

        print(
            f"[diagnostics] Warning: Initialisation failed: {exc}",
            flush=True,
        )

    print("\n========== QUEUED APPLICATION ==========")
    print(f"Job ID:          {job['id']}")
    print(f"Title:           {job['title']}")
    print(f"Company:         {job['company']}")
    print(f"Application URL: {job['applicationUrl']}")
    print(f"Log:             {LOG_FILE}")
    print("========================================\n")

    form_details_path = Path(__file__).parent / "../app/src/ai/form-details.json"

    

    with form_details_path.open("r", encoding="utf-8") as f:
        form_details = json.load(f)

    # ---------------------------------------------------------
    # Cover letter path
    # ---------------------------------------------------------

    cover_letters_dir = (
        project_root / "app" / "src" / "ai" / "cover-letters"
    )

    safe_company_name = re.sub(
        r'\s+',
        '-',
        re.sub(
            r'[<>:"/\\|?*\x00-\x1F]',
            '',
            job["company"],
        ),
    ).strip('-')

    safe_company_name = re.sub(r'-+', '-', safe_company_name)

    cover_letter_path = (
        cover_letters_dir / f"GAARDER-{safe_company_name}-COVER.docx"
    )

    print(f"[documents] Cover letter path: {cover_letter_path}")
    print(f"[documents] File exists: {cover_letter_path.is_file()}")

    candidate_data = json.dumps(form_details, indent=2)

    

    llm = ChatGoogle(
        model="gemini-3.8-flash",
    )

    # Track LLM request durations and any usage metadata returned.
    if _diagnostics is not None:
        try:
            _diagnostics.instrument_llm(llm)
            print("[diagnostics] LLM instrumentation enabled", flush=True)
        except Exception as exc:
            print(
                f"[diagnostics] Warning: LLM instrumentation failed: {exc}",
                flush=True,
            )

    browser = Browser(
        keep_alive=True,
        headless=False,
    )

    agent = Agent(
        task=f"""
Your task is to complete the application form using candidate data.

JOB APPLICATION:

{job["applicationUrl"]}

CANDIDATE DATA:

{candidate_data}

Your responsibility is to interact directly with the application website
and fill the application form.

RULES:

Inspect the current page before acting.

For dropdowns, radio buttons, checkboxes, and Yes/No questions, only
select an answer when the corresponding answer is explicitly
established by the candidate data.

FILE UPLOAD RULES:

When a form requires a CV or résumé, use Browser Use's upload_file
browser action to upload the candidate CV.

When a form requires a cover letter as a document, upload the generated
cover letter for the current job using upload_file.

The candidate CV is the file specified in documents.cv.

The cover letter for the current job is:
{cover_letter_path}

Do not confuse the CV with the cover letter.

If the application provides a cover-letter text field instead of a file
upload, use the generated cover-letter text if it is available.
""",
        llm=llm,
        browser=browser,
        llm_timeout=900,
        available_file_paths=[
            "/Users/matteusgaarder/Desktop/Projects/employ-me/app/src/ai/GAARDER-CV.docx",
            str(cover_letter_path),
        ],
        # Hook into Browser Use's own Ctrl+C exit path.
        # This fires just before Browser Use calls sys.exit() on the second Ctrl+C.
        custom_exit_callback=_cancel_on_exit,
    )

    _diagnostics_agent = agent

    try:
        # Tell employ-me that Browser Use is starting → RUNNING.
        start_application_run()

        print("\n========== BROWSER USE START ==========\n")

        result = await agent.run(
            on_step_start=report_step_start,
            on_step_end=report_step_end,
        )

        HISTORY_FILE.write_text(
            json.dumps(result, default=str, indent=2),
            encoding="utf-8",
        )

        print("\n========== BROWSER USE COMPLETE ==========\n")
        print(f"History saved to: {HISTORY_FILE}")
        print(f"Log saved to:     {LOG_FILE}")
        print("===========================================\n")

        # Save the final diagnostics report.
        if _diagnostics is not None:
            try:
                await _diagnostics.finalize(
                    agent=agent,
                    outcome="COMPLETED",
                )
            except Exception as exc:
                print(
                    f"[diagnostics] Warning: Finalisation failed: {exc}",
                    flush=True,
                )

        # Mark the run as complete — deregister cancel atexit before calling.
        _cancellation_done_set()
        complete_application_run(
            steps_completed=current_step,
            final_result=str(result),
            log_file=str(LOG_FILE),
            history_file=str(HISTORY_FILE),
        )

        # Sync final SQLite application status back to Notion.
        subprocess.run(
            ["npm", "run", "sync:notion:reverse"],
            cwd=str(Path(__file__).parent / "../app"),
            check=True,
        )

    except KeyboardInterrupt:
        # asyncio may surface the interrupt here before Browser Use's handler
        # gets a chance. _cancel_on_exit() handles deduplication.
        print("\n========== BROWSER USE CANCELLED ==========\n")
        _cancel_on_exit()
        sys.exit(1)

    except Exception as error:
        print("\n========== BROWSER USE ERROR ==========\n")
        print(error)
        print("\n=======================================\n")

        # Preserve diagnostics for failed application runs.
        if _diagnostics is not None:
            try:
                await _diagnostics.finalize(
                    agent=_diagnostics_agent,
                    outcome="FAILED",
                    error_message=str(error),
                )
            except Exception as exc:
                print(
                    f"[diagnostics] Warning: Finalisation failed: {exc}",
                    flush=True,
                )

        # Deregister cancel — we're going to call fail instead.
        _cancellation_done_set()

        if "result" in locals():
            try:
                HISTORY_FILE.write_text(
                    json.dumps(result, default=str, indent=2),
                    encoding="utf-8",
                )
            except Exception as history_error:
                print(f"[history] Failed to save history: {history_error}")

        fail_application_run(
            error_message=str(error),
            log_file=str(LOG_FILE),
            history_file=(
                str(HISTORY_FILE)
                if HISTORY_FILE and HISTORY_FILE.exists()
                else None
            ),
        )

        raise

    finally:
        stop_console_logging()


def _cancellation_done_set():
    """Mark cancellation as already handled so the atexit hook does nothing."""
    global _cancellation_done
    _cancellation_done = True


if __name__ == "__main__":
    asyncio.run(main())
