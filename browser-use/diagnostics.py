import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("browser_use.diagnostics")


class RunDiagnostics:
    """
    Observability, token tracking, and diagnostics collector for Browser Use.

    Captures:
    - Step-level timing (start, end, duration)
    - LLM request timing, durations, statuses, and token usage per step
    - Distinction between LLM latency and browser/page latency
    - Stated agent goals, memory, evaluations, actions, and results
    - Token accounting and cost estimation (from native TokenCost service)
    - Step timeouts vs LLM timeouts
    - Comprehensive run summary and JSON diagnostics export
    """

    def __init__(
        self,
        run_id: int | None,
        model: str,
        browser_use_version: str,
        step_timeout: int = 180,
        llm_timeout: int | None = 180,
        run_dir: Path | None = None,
        log_file: Path | None = None,
        history_file: Path | None = None,
        diagnostics_file: Path | None = None,
        conversation_dir: Path | None = None,
        gif_file: Path | None = None,
    ):
        self.run_id = run_id
        self.model = model
        self.browser_use_version = browser_use_version
        self.step_timeout = step_timeout
        self.llm_timeout = llm_timeout

        self.run_dir = run_dir
        self.log_file = log_file
        self.history_file = history_file
        self.diagnostics_file = diagnostics_file
        self.conversation_dir = conversation_dir
        self.gif_file = gif_file

        self.start_time = time.time()
        self.end_time: float | None = None
        self.outcome = "RUNNING"
        self.error_message: str | None = None

        self.steps: list[dict[str, Any]] = []
        self.llm_calls: list[dict[str, Any]] = []

        self.current_step_number = 0
        self.current_step_data: dict[str, Any] | None = None

        self.usage_summary: dict[str, Any] | None = None
        self.cost_estimated: bool = False
        self.pricing_available: bool = False

        self._finalized = False

    def instrument_llm(self, llm: Any) -> Any:
        """
        Wrap an LLM instance's ainvoke method to capture request-level timing,
        duration, errors, and token metadata without altering its behavior.
        """
        original_ainvoke = getattr(llm, "ainvoke", None)
        if not original_ainvoke:
            return llm

        diagnostics_self = self

        async def timed_ainvoke(messages: Any, output_format: Any = None, **kwargs: Any) -> Any:
            call_start = time.time()
            step_num = diagnostics_self.current_step_number
            call_idx = len(diagnostics_self.llm_calls) + 1

            call_record: dict[str, Any] = {
                "call_index": call_idx,
                "step_number": step_num,
                "start_time": call_start,
                "start_time_iso": datetime.fromtimestamp(call_start).isoformat(),
                "model": getattr(llm, "model", diagnostics_self.model),
                "status": "IN_PROGRESS",
                "duration_seconds": None,
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "prompt_cached_tokens": None,
                "prompt_image_tokens": None,
                "error": None,
            }
            diagnostics_self.llm_calls.append(call_record)

            try:
                result = await original_ainvoke(messages, output_format=output_format, **kwargs)
                call_end = time.time()
                duration = round(call_end - call_start, 2)

                call_record["end_time"] = call_end
                call_record["end_time_iso"] = datetime.fromtimestamp(call_end).isoformat()
                call_record["duration_seconds"] = duration
                call_record["status"] = "SUCCESS"

                usage = getattr(result, "usage", None)
                if usage:
                    call_record["prompt_tokens"] = getattr(usage, "prompt_tokens", None)
                    call_record["completion_tokens"] = getattr(usage, "completion_tokens", None)
                    call_record["total_tokens"] = getattr(usage, "total_tokens", None)
                    call_record["prompt_cached_tokens"] = getattr(usage, "prompt_cached_tokens", None)
                    call_record["prompt_image_tokens"] = getattr(usage, "prompt_image_tokens", None)

                return result

            except asyncio.CancelledError as ce:
                call_end = time.time()
                duration = round(call_end - call_start, 2)
                call_record["end_time"] = call_end
                call_record["end_time_iso"] = datetime.fromtimestamp(call_end).isoformat()
                call_record["duration_seconds"] = duration
                call_record["status"] = "CANCELLED"
                call_record["error"] = "Cancelled during execution (likely step or agent timeout)"
                raise ce

            except Exception as exc:
                call_end = time.time()
                duration = round(call_end - call_start, 2)
                call_record["end_time"] = call_end
                call_record["end_time_iso"] = datetime.fromtimestamp(call_end).isoformat()
                call_record["duration_seconds"] = duration
                call_record["status"] = "ERROR"
                call_record["error"] = str(exc)
                raise exc

        try:
            object.__setattr__(llm, "ainvoke", timed_ainvoke)
        except Exception:
            try:
                setattr(llm, "ainvoke", timed_ainvoke)
            except Exception as e:
                logger.warning(f"Failed to attach timing instrumentation to LLM: {e}")

        return llm

    def on_step_start(self, agent: Any, step_number: int) -> None:
        """Called when a step starts."""
        now = time.time()
        self.current_step_number = step_number

        self.current_step_data = {
            "step_number": step_number,
            "start_time": now,
            "start_time_iso": datetime.fromtimestamp(now).isoformat(),
            "end_time": None,
            "end_time_iso": None,
            "duration_seconds": None,
            "llm_duration_seconds": 0.0,
            "browser_duration_seconds": 0.0,
            "llm_calls_count": 0,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "outcome": "IN_PROGRESS",
            "evaluation_previous_goal": None,
            "memory": None,
            "next_goal": None,
            "actions": [],
            "action_results": [],
            "error": None,
        }

        print(
            f"[diagnostics] Step {step_number} started at {datetime.fromtimestamp(now).strftime('%H:%M:%S')}",
            flush=True,
        )

    def on_step_end(self, agent: Any, step_number: int) -> None:
        """Called when a step finishes, times out, or fails."""
        now = time.time()
        step_data = self.current_step_data

        if not step_data or step_data.get("step_number") != step_number:
            step_data = {
                "step_number": step_number,
                "start_time": now,
                "start_time_iso": datetime.fromtimestamp(now).isoformat(),
                "end_time": now,
                "end_time_iso": datetime.fromtimestamp(now).isoformat(),
                "duration_seconds": 0.0,
                "llm_duration_seconds": 0.0,
                "browser_duration_seconds": 0.0,
                "llm_calls_count": 0,
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "outcome": "UNKNOWN",
                "evaluation_previous_goal": None,
                "memory": None,
                "next_goal": None,
                "actions": [],
                "action_results": [],
                "error": None,
            }

        start_time = step_data["start_time"]
        duration = round(now - start_time, 2)
        step_data["end_time"] = now
        step_data["end_time_iso"] = datetime.fromtimestamp(now).isoformat()
        step_data["duration_seconds"] = duration

        # Correlate LLM calls made during this step
        step_llm_calls = [c for c in self.llm_calls if c["step_number"] == step_number]
        step_data["llm_calls_count"] = len(step_llm_calls)

        llm_dur = round(sum(c.get("duration_seconds") or 0.0 for c in step_llm_calls), 2)
        step_data["llm_duration_seconds"] = llm_dur

        browser_dur = max(0.0, round(duration - llm_dur, 2))
        step_data["browser_duration_seconds"] = browser_dur

        # Sum token counts for this step
        prompt_tok = sum(c.get("prompt_tokens") or 0 for c in step_llm_calls)
        comp_tok = sum(c.get("completion_tokens") or 0 for c in step_llm_calls)
        total_tok = sum(c.get("total_tokens") or 0 for c in step_llm_calls)

        if step_llm_calls and any(c.get("prompt_tokens") is not None for c in step_llm_calls):
            step_data["prompt_tokens"] = prompt_tok
            step_data["completion_tokens"] = comp_tok
            step_data["total_tokens"] = total_tok

        # Inspect agent state and history for step results and errors
        last_result = getattr(agent.state, "last_result", None) if hasattr(agent, "state") else None
        last_model_output = getattr(agent.state, "last_model_output", None) if hasattr(agent, "state") else None
        history_list = getattr(agent.history, "history", []) if hasattr(agent, "history") else []

        # Check for timeout error in last_result
        is_timeout = False
        step_error: str | None = None

        if last_result and isinstance(last_result, list):
            for res in last_result:
                err = getattr(res, "error", None)
                if err:
                    step_error = str(err)
                    if "timed out" in step_error.lower() or "timeout" in step_error.lower():
                        is_timeout = True
                        break

        # Check latest history entry if available
        matched_history_item = None
        if history_list:
            matched_history_item = history_list[-1]

        model_output = getattr(matched_history_item, "model_output", None) if matched_history_item else last_model_output

        if model_output:
            step_data["evaluation_previous_goal"] = getattr(model_output, "evaluation_previous_goal", None)
            step_data["memory"] = getattr(model_output, "memory", None)
            step_data["next_goal"] = getattr(model_output, "next_goal", None)

            actions = getattr(model_output, "action", [])
            action_summaries = []
            for act in actions:
                if hasattr(act, "model_dump"):
                    dump = act.model_dump(exclude_none=True)
                    # Redact potential sensitive values from logs
                    for key in ["password", "token", "secret", "cv"]:
                        if key in dump:
                            dump[key] = "[REDACTED]"
                    action_summaries.append(dump)
                else:
                    action_summaries.append(str(act))
            step_data["actions"] = action_summaries

        results = getattr(matched_history_item, "result", None) if matched_history_item else last_result
        if results and isinstance(results, list):
            res_summaries = []
            for r in results:
                err = getattr(r, "error", None)
                content = getattr(r, "extracted_content", None)
                is_done = getattr(r, "is_done", False)
                res_summaries.append({
                    "is_done": is_done,
                    "extracted_content": content[:120] if content else None,
                    "error": err,
                })
                if err and not step_error:
                    step_error = str(err)
            step_data["action_results"] = res_summaries

        # Set final step outcome
        if is_timeout:
            step_data["outcome"] = "TIMED_OUT"
            step_data["error"] = step_error or f"Step {step_number} timed out after {self.step_timeout}s"
        elif step_error:
            step_data["outcome"] = "FAILED"
            step_data["error"] = step_error
        else:
            step_data["outcome"] = "COMPLETED"

        self.steps.append(step_data)
        self.current_step_data = None

        # Print step-level observability line
        llm_pct = int((llm_dur / duration) * 100) if duration > 0 else 0
        browser_pct = max(0, 100 - llm_pct)
        tok_str = f"{total_tok:,} tokens" if total_tok else "tokens: unavailable"

        print(
            f"[diagnostics] Step {step_number} finished in {duration:.1f}s "
            f"(LLM: {llm_dur:.1f}s [{llm_pct}%], Browser: {browser_dur:.1f}s [{browser_pct}%]) "
            f"[{step_data['outcome']}] | {tok_str}",
            flush=True,
        )
        if step_data.get("next_goal"):
            print(f"  Goal: {step_data['next_goal']}", flush=True)
        if step_data.get("error"):
            print(f"  Error: {step_data['error']}", flush=True)

    async def finalize(
        self,
        agent: Any = None,
        outcome: str = "COMPLETED",
        error_message: str | None = None,
    ) -> None:
        """
        Finalize diagnostics collection, retrieve TokenCost summary,
        format and print Run Summary, and save diagnostics.json.
        Safe against any exceptions.
        """
        if self._finalized:
            return
        self._finalized = True

        self.end_time = time.time()
        self.outcome = outcome
        if error_message:
            self.error_message = error_message

        # If a step was in progress when finalize was called (e.g. timeout/crash), close it
        if self.current_step_data and self.current_step_data.get("duration_seconds") is None:
            now = self.end_time
            start = self.current_step_data["start_time"]
            dur = round(now - start, 2)
            self.current_step_data["end_time"] = now
            self.current_step_data["end_time_iso"] = datetime.fromtimestamp(now).isoformat()
            self.current_step_data["duration_seconds"] = dur
            self.current_step_data["outcome"] = outcome if outcome in ("CANCELLED", "TIMED_OUT") else "FAILED"
            self.current_step_data["error"] = error_message
            self.steps.append(self.current_step_data)
            self.current_step_data = None

        # Query native TokenCost service
        token_cost_service = getattr(agent, "token_cost_service", None) if agent else None

        if token_cost_service:
            try:
                summary_obj = await token_cost_service.get_usage_summary()
                if summary_obj:
                    pricing = await token_cost_service.get_model_pricing(self.model)
                    self.pricing_available = pricing is not None

                    by_model_dict = {}
                    for m_name, m_stats in getattr(summary_obj, "by_model", {}).items():
                        by_model_dict[m_name] = {
                            "prompt_tokens": getattr(m_stats, "prompt_tokens", 0),
                            "completion_tokens": getattr(m_stats, "completion_tokens", 0),
                            "total_tokens": getattr(m_stats, "total_tokens", 0),
                            "cost": round(getattr(m_stats, "cost", 0.0), 6),
                            "invocations": getattr(m_stats, "invocations", 0),
                            "average_tokens_per_invocation": round(getattr(m_stats, "average_tokens_per_invocation", 0.0), 1),
                        }

                    self.usage_summary = {
                        "total_prompt_tokens": getattr(summary_obj, "total_prompt_tokens", 0),
                        "total_completion_tokens": getattr(summary_obj, "total_completion_tokens", 0),
                        "total_tokens": getattr(summary_obj, "total_tokens", 0),
                        "total_prompt_cached_tokens": getattr(summary_obj, "total_prompt_cached_tokens", 0),
                        "total_cost": round(getattr(summary_obj, "total_cost", 0.0), 6),
                        "entry_count": getattr(summary_obj, "entry_count", 0),
                        "by_model": by_model_dict,
                    }
                    self.cost_estimated = token_cost_service.include_cost and self.pricing_available
            except Exception as e:
                logger.debug(f"Failed to fetch usage summary from token_cost_service: {e}")

        # Fallback to history.usage if token_cost_service wasn't available or had no data
        if not self.usage_summary and agent and hasattr(agent, "history") and hasattr(agent.history, "usage"):
            hist_usage = agent.history.usage
            if hist_usage:
                try:
                    self.usage_summary = {
                        "total_prompt_tokens": getattr(hist_usage, "total_prompt_tokens", 0),
                        "total_completion_tokens": getattr(hist_usage, "total_completion_tokens", 0),
                        "total_tokens": getattr(hist_usage, "total_tokens", 0),
                        "total_prompt_cached_tokens": getattr(hist_usage, "total_prompt_cached_tokens", 0),
                        "total_cost": round(getattr(hist_usage, "total_cost", 0.0), 6),
                        "entry_count": getattr(hist_usage, "entry_count", 0),
                    }
                except Exception:
                    pass

        # Print the comprehensive summary
        summary_text = self.format_summary_text()
        print(summary_text, flush=True)

        # Save diagnostics JSON
        self.save_diagnostics_file()

    def sync_finalize(
        self,
        agent: Any = None,
        outcome: str = "COMPLETED",
        error_message: str | None = None,
    ) -> None:
        """
        Synchronous finalization for atexit or signal handlers where async/await is unavailable.
        """
        if self._finalized:
            return
        self._finalized = True

        self.end_time = time.time()
        self.outcome = outcome
        if error_message:
            self.error_message = error_message

        if self.current_step_data and self.current_step_data.get("duration_seconds") is None:
            now = self.end_time
            start = self.current_step_data["start_time"]
            dur = round(now - start, 2)
            self.current_step_data["end_time"] = now
            self.current_step_data["end_time_iso"] = datetime.fromtimestamp(now).isoformat()
            self.current_step_data["duration_seconds"] = dur
            self.current_step_data["outcome"] = outcome if outcome in ("CANCELLED", "TIMED_OUT") else "FAILED"
            self.current_step_data["error"] = error_message
            self.steps.append(self.current_step_data)
            self.current_step_data = None

        # Synchronously compute usage summary from token_cost_service.usage_history if available
        token_cost_service = getattr(agent, "token_cost_service", None) if agent else None
        if token_cost_service and hasattr(token_cost_service, "usage_history") and token_cost_service.usage_history:
            total_prompt = sum(u.usage.prompt_tokens for u in token_cost_service.usage_history)
            total_comp = sum(u.usage.completion_tokens for u in token_cost_service.usage_history)
            total_cached = sum(getattr(u.usage, "prompt_cached_tokens", 0) or 0 for u in token_cost_service.usage_history)
            self.usage_summary = {
                "total_prompt_tokens": total_prompt,
                "total_completion_tokens": total_comp,
                "total_tokens": total_prompt + total_comp,
                "total_prompt_cached_tokens": total_cached,
                "total_cost": 0.0,
                "entry_count": len(token_cost_service.usage_history),
            }

        summary_text = self.format_summary_text()
        print(summary_text, flush=True)
        self.save_diagnostics_file()

    def format_summary_text(self) -> str:
        """Produce the clearly formatted text summary for console and log file."""
        total_dur = round((self.end_time or time.time()) - self.start_time, 1)

        total_steps = len(self.steps)
        completed_steps = sum(1 for s in self.steps if s["outcome"] == "COMPLETED")
        timed_out_steps = sum(1 for s in self.steps if s["outcome"] == "TIMED_OUT")
        failed_steps = sum(1 for s in self.steps if s["outcome"] == "FAILED")
        cancelled_steps = sum(1 for s in self.steps if s["outcome"] == "CANCELLED")

        # LLM totals from request tracker
        total_llm_requests = len(self.llm_calls)
        successful_llm_requests = sum(1 for c in self.llm_calls if c["status"] == "SUCCESS")
        failed_llm_requests = sum(1 for c in self.llm_calls if c["status"] in ("ERROR", "CANCELLED"))
        total_llm_duration = round(sum(c.get("duration_seconds") or 0.0 for c in self.llm_calls), 1)
        avg_llm_duration = (
            f"{round(total_llm_duration / total_llm_requests, 1):.1f}s"
            if total_llm_requests > 0
            else "unavailable"
        )

        # Token stats
        if self.usage_summary and self.usage_summary.get("total_tokens", 0) > 0:
            prompt_tok = f"{self.usage_summary['total_prompt_tokens']:,}"
            comp_tok = f"{self.usage_summary['total_completion_tokens']:,}"
            total_tok = f"{self.usage_summary['total_tokens']:,}"
            cached_tok_val = self.usage_summary.get("total_prompt_cached_tokens")
            cached_tok = f"{cached_tok_val:,}" if cached_tok_val else "0"
            if self.cost_estimated and self.usage_summary.get("total_cost", 0.0) > 0:
                cost_str = f"${self.usage_summary['total_cost']:.4f} (estimated via LiteLLM pricing rates)"
            elif not self.pricing_available:
                cost_str = f"unavailable (no LiteLLM pricing data for {self.model})"
            else:
                cost_str = "$0.0000"
        else:
            # Aggregate from instrumented calls if native usage was empty (e.g. aborted run)
            calls_with_tokens = [c for c in self.llm_calls if c.get("prompt_tokens") is not None]
            if calls_with_tokens:
                p_sum = sum(c["prompt_tokens"] for c in calls_with_tokens)
                c_sum = sum(c["completion_tokens"] for c in calls_with_tokens)
                t_sum = sum(c["total_tokens"] for c in calls_with_tokens)
                prompt_tok = f"{p_sum:,}"
                comp_tok = f"{c_sum:,}"
                total_tok = f"{t_sum:,}"
                cached_tok = "unavailable"
                cost_str = "unavailable (partial/uncalculated)"
            else:
                prompt_tok = "unavailable"
                comp_tok = "unavailable"
                total_tok = "unavailable"
                cached_tok = "unavailable"
                cost_str = "unavailable"

        lines = [
            "",
            "=" * 60,
            "========== BROWSER USE RUN SUMMARY ==========",
            "=" * 60,
            f"Run ID:               {self.run_id if self.run_id is not None else 'N/A'}",
            f"Model:                {self.model}",
            f"Browser Use version:  {self.browser_use_version}",
            f"Outcome:              {self.outcome}",
            f"Total duration:       {total_dur}s",
            f"Total steps:          {total_steps}",
            f"  Completed steps:    {completed_steps}",
            f"  Timed-out steps:    {timed_out_steps}",
            f"  Failed steps:       {failed_steps}" + (f" (Cancelled: {cancelled_steps})" if cancelled_steps else ""),
            "",
            "--- Model & Token Observability ---",
            f"LLM requests:         {total_llm_requests} (successful: {successful_llm_requests}, timed-out/failed: {failed_llm_requests})",
            f"Total LLM latency:    {total_llm_duration}s (avg: {avg_llm_duration}/request)",
            f"Input tokens:         {prompt_tok} (reported by Google API)",
            f"Output tokens:        {comp_tok} (reported by Google API)",
            f"Cached input tokens:  {cached_tok} (reported by Google API)",
            f"Reasoning tokens:     unavailable (bundled into completion tokens in 0.13.8)",
            f"Total tokens:         {total_tok}",
            f"Estimated API cost:   {cost_str}",
            "",
            "--- Step-by-Step Breakdown ---",
        ]

        if not self.steps:
            lines.append("  No steps recorded.")
        else:
            for s in self.steps:
                s_num = s["step_number"]
                s_dur = f"{s.get('duration_seconds', 0.0):.1f}s"
                llm_dur_s = f"{s.get('llm_duration_seconds', 0.0):.1f}s"
                browser_dur_s = f"{s.get('browser_duration_seconds', 0.0):.1f}s"
                outcome_s = s.get("outcome", "UNKNOWN")
                tok_s = f"{s.get('total_tokens', 0):,} tokens" if s.get("total_tokens") else "tokens: unavailable"

                lines.append(
                    f"Step {s_num}: {s_dur} [{outcome_s}] | Latency: LLM {llm_dur_s}, Browser {browser_dur_s} | {tok_s}"
                )
                if s.get("next_goal"):
                    lines.append(f"  Goal:    {s['next_goal']}")
                if s.get("actions"):
                    act_names = [list(a.keys())[0] if isinstance(a, dict) and a else str(a) for a in s["actions"]]
                    lines.append(f"  Actions: {', '.join(act_names)}")
                if s.get("error"):
                    lines.append(f"  Error:   {s['error']}")

        lines.extend([
            "",
            "--- Diagnostic Artifacts ---",
            f"Log file:             {self.log_file if self.log_file and self.log_file.exists() else 'N/A'}",
            f"History file:         {self.history_file if self.history_file and self.history_file.exists() else 'N/A'}",
            f"Diagnostics file:     {self.diagnostics_file if self.diagnostics_file else 'N/A'}",
            f"Conversation history: {self.conversation_dir if self.conversation_dir and self.conversation_dir.exists() else 'disabled / not generated'}",
            f"Browser recording:    {self.gif_file if self.gif_file and self.gif_file.exists() else 'disabled / not generated'}",
            "=" * 60,
            "",
        ])

        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        """Convert all diagnostics to a serializable dictionary."""
        return {
            "runId": self.run_id,
            "model": self.model,
            "browserUseVersion": self.browser_use_version,
            "outcome": self.outcome,
            "errorMessage": self.error_message,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "totalDurationSeconds": round((self.end_time or time.time()) - self.start_time, 2),
            "timeouts": {
                "stepTimeoutSeconds": self.step_timeout,
                "llmTimeoutSeconds": self.llm_timeout,
            },
            "stepsSummary": {
                "total": len(self.steps),
                "completed": sum(1 for s in self.steps if s["outcome"] == "COMPLETED"),
                "timedOut": sum(1 for s in self.steps if s["outcome"] == "TIMED_OUT"),
                "failed": sum(1 for s in self.steps if s["outcome"] == "FAILED"),
                "cancelled": sum(1 for s in self.steps if s["outcome"] == "CANCELLED"),
            },
            "usageSummary": self.usage_summary,
            "costEstimated": self.cost_estimated,
            "pricingAvailable": self.pricing_available,
            "llmLatency": {
                "totalSeconds": round(sum(c.get("duration_seconds") or 0.0 for c in self.llm_calls), 2),
                "requestsCount": len(self.llm_calls),
                "successfulRequests": sum(1 for c in self.llm_calls if c["status"] == "SUCCESS"),
                "failedRequests": sum(1 for c in self.llm_calls if c["status"] in ("ERROR", "CANCELLED")),
            },
            "steps": self.steps,
            "llmCalls": self.llm_calls,
            "artifacts": {
                "logFile": str(self.log_file) if self.log_file else None,
                "historyFile": str(self.history_file) if self.history_file else None,
                "diagnosticsFile": str(self.diagnostics_file) if self.diagnostics_file else None,
                "conversationDir": str(self.conversation_dir) if self.conversation_dir else None,
                "gifFile": str(self.gif_file) if self.gif_file else None,
            },
        }

    def save_diagnostics_file(self) -> None:
        """Write diagnostics JSON to disk."""
        if not self.diagnostics_file:
            return

        try:
            self.diagnostics_file.parent.mkdir(parents=True, exist_ok=True)
            data = self.to_dict()
            self.diagnostics_file.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
        except Exception as e:
            # Monitoring failure must never conceal the original workflow
            print(f"[diagnostics] Warning: Failed to write diagnostics file: {e}", flush=True)
