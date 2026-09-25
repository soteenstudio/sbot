# SBot

## Music playback on Termux

The `/play` command uses a Node.js YouTube extractor installed by npm and needs `ffmpeg` for audio conversion. In Termux:

```sh
pkg update
pkg install nodejs ffmpeg
npm ci
npm start
```

Check that `ffmpeg -version` works in the same shell that starts the bot. `/play` accepts a song title or an HTTP(S) YouTube video link; audio is streamed through memory without a downloaded file. Set `PLAY_USAGE_FILE` to change the path of the persistent daily usage file (default: `data/play-usage.json`).

When YouTube provides no directly downloadable audio, playback tries the SABR audio stream instead. Some SABR responses require a session-bound proof-of-origin token; if your deployment has one, pass it as `PLAY_PO_TOKEN` (base64) when starting the bot. Without a valid token or required streaming metadata, playback reports an extraction error rather than charging a play. No challenge code is run to obtain tokens.
