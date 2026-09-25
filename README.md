# SBot

## Music playback on Termux

`/play` searches publicly streamable tracks on [Audius](https://audius.co/) by song title. It streams audio through memory into the Discord voice channel, without saving a file or using Python. Links (including YouTube links) are not supported; Audius does not provide a YouTube video catalog. The bot plays one track per guild at a time: another `/play` replaces it; there is no queue.

```sh
pkg update
pkg install nodejs ffmpeg
npm ci
npm start
```

Confirm `ffmpeg -version` works in the bot's shell. `ffmpeg` converts the provider's audio stream for Discord; set `PLAY_USAGE_FILE` to change the persistent daily usage path (default `data/play-usage.json`).

Audius [documents free API access and streaming for third-party applications](https://docs.audius.co/), and its [REST API](https://docs.audius.co/api/) provides track search and stream endpoints. Public searches/streams currently work without credentials; no API key or token is required for this integration. Audius may rate-limit requests (HTTP 429); retry later if that happens. Only tracks whose metadata grants streaming are selected, so results are limited to Audius's catalog and tracks available for streaming. Review Audius's current developer terms and limits before deploying at scale.
