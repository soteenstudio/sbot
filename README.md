# SBot

## Music playback on Termux

The `/play` command needs `yt-dlp` and `ffmpeg` installed separately from npm. In Termux:

```sh
pkg update
pkg install nodejs python ffmpeg
pip install -U yt-dlp
npm ci
npm start
```

Check that `yt-dlp --version` and `ffmpeg -version` both work in the same shell that starts the bot. Keep `yt-dlp` updated if YouTube changes its extraction requirements. `/play` accepts a song title or supported HTTP(S) video link; audio is streamed through memory without a downloaded file. Set `PLAY_USAGE_FILE` to change the path of the persistent daily usage file (default: `data/play-usage.json`).
