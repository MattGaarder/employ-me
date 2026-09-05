
import asyncio
import json
from pathlib import Path

from browser_use import Agent, ChatOllama


async def main():
    form_details_path = Path("../app/src/ai/form-details.json")

    with form_details_path.open("r", encoding="utf-8") as f:
        form_details = json.load(f)

    candidate_data = json.dumps(form_details, indent=2)
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
https://biophorum.bamboohr.com/careers/217?source=LinkedIn

CANDIDATE DATA:
```json
{candidate_data}

Your responsibility is to interact directly with the application website
and fill the application form.

RULES:

Inspect the current page before acting.

For dropdowns, radio buttons, checkboxes, and Yes/No questions, only
select an answer when the corresponding answer is explicitly
established by the candidate data.

FILE UPLOAD RULE:
When a form requires a CV or other document, use Browser Use's upload_file browser action. Do not use the normal input action to enter a filesystem path. Do not navigate to the file path. Do not open a file:// URL. Do not attempt to interact with the macOS Finder/file picker. The candidate CV is the local file specified in documents.cv. Upload it directly to the website's file-upload control.
""",
        llm=llm,
        llm_timeout=900,
        available_file_paths=[
            "/Users/matteusgaarder/Desktop/Projects/employ-me/app/src/ai/GAARDER-CV.docx"
        ],
    )

    result = await agent.run()

    print("\n========== RESULT ==========\n")
    print(result)
    print("\n============================\n")

if __name__ == "__main__":
    asyncio.run(main())