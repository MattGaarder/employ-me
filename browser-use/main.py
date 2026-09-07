
import asyncio
import json
import sys
import os
import threading
from pathlib import Path

import requests

from browser_use import Agent, ChatOllama


API_BASE_URL = "http://localhost:3001/api"

RUN_ID = None
current_step = 0

# ---------------------------------------------------------
# Run file paths
# ---------------------------------------------------------

RUN_DIR = None
HISTORY_FILE = None
LOG_FILE = None


def setup_run_files(run_id: int):
    global RUN_DIR, HISTORY_FILE, LOG_FILE

    RUN_DIR = Path("runs") / str(run_id)
    RUN_DIR.mkdir(parents=True, exist_ok=True)

    HISTORY_FILE = RUN_DIR / "history.json"
    LOG_FILE = RUN_DIR / "run.log"

# ---------------------------------------------------------
# Console logging
# ---------------------------------------------------------

console_log_file = None
console_log_thread = None
console_log_stop = None
console_stdout_fd = None
console_stderr_fd = None


def start_console_logging():
    """
    Capture everything written to stdout/stderr at the OS file-descriptor
    level while still displaying it normally in the terminal.

    Anything that appears in the console should therefore also appear
    in runs/<run_id>/run.log.
    """

    global console_log_file
    global console_log_thread
    global console_log_stop
    global console_stdout_fd
    global console_stderr_fd

    console_log_file = LOG_FILE.open(
        "w",
        encoding="utf-8",
        buffering=1,
    )

    # Preserve the original terminal file descriptors.
    console_stdout_fd = os.dup(1)
    console_stderr_fd = os.dup(2)

    # Create a pipe.
    read_fd, write_fd = os.pipe()

    # Redirect both stdout and stderr into the same pipe.
    os.dup2(write_fd, 1)
    os.dup2(write_fd, 2)

    # The duplicated stdout/stderr descriptors now own the pipe.
    os.close(write_fd)

    console_log_stop = threading.Event()

    def capture_console():
        with os.fdopen(read_fd, "rb", closefd=True) as pipe:
            while not console_log_stop.is_set():
                data = os.read(pipe.fileno(), 8192)

                if not data:
                    break

                # Write exactly what was written to the console
                # to the run log.
                console_log_file.buffer.write(data)
                console_log_file.flush()

                # Also write it back to the original terminal.
                os.write(console_stdout_fd, data)

    console_log_thread = threading.Thread(
        target=capture_console,
        name="console-log-capture",
        daemon=True,
    )

    console_log_thread.start()

def stop_console_logging():
    """
    Restore the original stdout/stderr file descriptors and close
    the console capture resources.
    """

    global console_log_file
    global console_log_thread
    global console_log_stop
    global console_stdout_fd
    global console_stderr_fd

    if console_stdout_fd is None:
        return

    # Flush Python's normal stdout/stderr buffers first.
    sys.stdout.flush()
    sys.stderr.flush()

    # Restore the original terminal stdout/stderr.
    os.dup2(console_stdout_fd, 1)
    os.dup2(console_stderr_fd, 2)

    # Close our duplicated terminal descriptors.
    os.close(console_stdout_fd)
    os.close(console_stderr_fd)

    console_stdout_fd = None
    console_stderr_fd = None

    # Tell the capture thread to stop.
    if console_log_stop is not None:
        console_log_stop.set()

    # Wait for the remaining pipe data to be written.
    if console_log_thread is not None:
        console_log_thread.join(timeout=2)

    console_log_thread = None
    console_log_stop = None

    if console_log_file is not None:
        console_log_file.flush()
        console_log_file.close()
        console_log_file = None

def claim_next_application():
    response = requests.post(
        f"{API_BASE_URL}/application-runs/claim"
    )
    response.raise_for_status()

    data = response.json()

    print("\n========== APPLICATION CLAIM ==========")
    print(data)
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

    print(
        f"[progress] Browser Use STARTED step {current_step}"
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
    print(
        f"[progress] Browser Use COMPLETED step {current_step}"
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


async def main():
    global RUN_ID

    claimed = claim_next_application()

    RUN_ID = claimed["runId"]
    job = claimed["job"]

    setup_run_files(RUN_ID)
    start_console_logging()

    print("\n========== QUEUED APPLICATION ==========")
    print(f"Job ID:          {job['id']}")
    print(f"Title:           {job['title']}")
    print(f"Company:         {job['company']}")
    print(f"Application URL: {job['applicationUrl']}")
    print("========================================\n")

    form_details_path = Path(
        "../app/src/ai/form-details.json"
    )

    with form_details_path.open(
        "r",
        encoding="utf-8",
    ) as f:
        form_details = json.load(f)

    candidate_data = json.dumps(
        form_details,
        indent=2,
    )

    llm = ChatOllama(
        model="qwen3.5:latest",
        timeout=300,
        ollama_options={
            "num_ctx": 32768,
            "think": True,
            "num_predict": 4096,
        },
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

FILE UPLOAD RULE:

When a form requires a CV or other document, use Browser Use's
upload_file browser action.

Do not use the normal input action to enter a filesystem path.

Do not navigate to the file path.

Do not open a file:// URL.

Do not attempt to interact with the macOS Finder/file picker.

The candidate CV is the local file specified in documents.cv.
Upload it directly to the website's file-upload control.

IMPORTANT:

Do not submit the application.

Stop before the final application submission.
""",
        llm=llm,
        llm_timeout=900,
        available_file_paths=[
            "/Users/matteusgaarder/Desktop/Projects/employ-me/app/src/ai/GAARDER-CV.docx"
        ],
    )

    try:

        # Tell employ-me that Browser Use is starting.
        start_application_run()

        print("\n========== BROWSER USE START ==========\n")

        result = await agent.run(
            on_step_start=report_step_start,
            on_step_end=report_step_end,
        )

        HISTORY_FILE.write_text(
            json.dumps(
                result,
                default=str,
                indent=2,
            ),
            encoding="utf-8",
        )

        print("\n========== BROWSER USE COMPLETE ==========\n")
        print(f"History saved to: {HISTORY_FILE}")
        print(f"Log saved to:     {LOG_FILE}")
        print("===========================================\n")

        complete_application_run(
            steps_completed=current_step,
            final_result=str(result),
            log_file=str(LOG_FILE),
            history_file=str(HISTORY_FILE),
        )

    except Exception as error:

        print("\n========== BROWSER USE ERROR ==========\n")
        print(error)
        print("\n=======================================\n")

                # Try to preserve whatever history is available if the
        # agent failed after producing a result.
        #
        # If `result` exists, save it.
        if "result" in locals():
            try:
                HISTORY_FILE.write_text(
                    json.dumps(
                        result,
                        default=str,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            except Exception as history_error:
                print(
                    f"[history] Failed to save history: {history_error}"
                )

        fail_application_run(
            error_message=str(error),
            log_file=str(LOG_FILE),
            history_file=(
                str(HISTORY_FILE)
                if HISTORY_FILE.exists()
                else None
            ),
        )

        raise

    finally:
        stop_console_logging()



if __name__ == "__main__":
    asyncio.run(main())
