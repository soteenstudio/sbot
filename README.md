# SBot

## Party voice channels

Use `/party game:<game>` to create a private voice channel for a game. The chosen game's role can join, and the command pings that role. The channel has a player limit and is deleted when the last human participant leaves.

Configure games in `src/lib/party-data.ts`. The three entries are examples; replace their labels, player limits, and role environment variables with your server's games and role IDs. Set `PARTY_ROLE_MINECRAFT`, `PARTY_ROLE_VALORANT`, and `PARTY_ROLE_FORTNITE` to the corresponding Discord role IDs when using the examples.
