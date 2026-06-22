# Missing series episodes fix

For a series such as **Najdu si tě / I Will Find You**, the old cache can contain `videos: []`. The server then creates only a fallback `S01E01`.

Version 3.4.3 retries series with missing episodes on every refresh (`EPISODE_REPAIR_RETRY_HOURS=0`) while keeping the normal 72-hour retry window for other metadata.

After deployment, run the workflow with **Force full TMDB rebuild = false**. Then deploy the latest cache commit to Render and reload/reinstall the addon in Nuvio.
