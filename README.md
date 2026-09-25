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
