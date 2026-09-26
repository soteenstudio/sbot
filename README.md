# SBot

## Party voice channels

Use `/party game:<game> [max_players:<number>]` to create a private voice channel for a game. The chosen game's role can join, and the command pings that role. Each game has a default player limit; set `max_players` from 1 to 10 to override it for one party. The channel is deleted when the last human participant leaves.

Channels that are still empty or contain only bots after five minutes are also deleted. New channels use the reserved name `sbot-party-<gameKey>-<hostId>` so the bot can recover them after a restart. On startup, channels with this marker and the expected party permission overwrites are tracked again; those without human participants are deleted. Older unmarked channels, renamed channels, and channels whose game role configuration or required permissions no longer match are preserved for manual cleanup.

Configure games in `src/lib/party-data.ts`. Set each game's role environment variable to its Discord role ID:

| Game | Default player limit | Role environment variable |
| --- | ---: | --- |
| Minecraft | 8 | `PARTY_ROLE_MINECRAFT` |
| Growtopia | 8 | `PARTY_ROLE_GROWTOPIA` |
| Roblox | 8 | `PARTY_ROLE_ROBLOX` |
| Free Fire | 4 | `PARTY_ROLE_FREEFIRE` |
| Mobile Legends | 5 | `PARTY_ROLE_MOBILELEGENDS` |
| Genshin Impact | 4 | `PARTY_ROLE_GENSHINIMPACT` |
| Valorant | 5 | `PARTY_ROLE_VALORANT` |
| Neverland | 8 | `PARTY_ROLE_NEVERLAND` |
