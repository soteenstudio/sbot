# SBot

## Party voice channels

Use `/party create game:<game> [max_players:<number>]` to create a private voice channel for a game. The chosen game's role can join, and the command pings that role. Each game has a default player limit; set `max_players` from 1 to 10 to override it for one party. Only one active party can exist per host. The channel is not deleted automatically.

Use `/party close` to delete your active party voice channel. This is the only way to delete a party voice channel. Use `/party list` to view all active party voice channels on the server.

The party host can use `/party kick participant:<member>` to disconnect a member who is currently in the party voice channel and deny them access to that channel. The restriction ends when the party channel is deleted and does not affect future parties.

For premium looking-for-group sessions, the host can use `/lfg-pro kick participant:<member>` to remove an accepted participant. The member is disconnected if they are in the session voice channel and cannot join that session again. Closing or ending the session deletes its voice channel and clears its participant restrictions; a new session starts with no kicked members.

New channels use the reserved name `sbot-party-<gameKey>-<hostId>` so the bot can recover them after a restart. On startup, channels with this marker and the expected party permission overwrites are tracked again, whether or not they are empty. Older unmarked channels, renamed channels, and channels whose game role configuration or required permissions no longer match are not tracked.

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
