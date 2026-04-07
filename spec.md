## Background

My friends and I have a set of NL Central major league baseball teams that we track each season. We have two running bets for these teams.
1. Who will perform the best against their beginning season over/under win total
2. Who has the most overall wins in a season

Each guy has a team assigned to them for life.

Additionally, one person picks 3 MLB games each week on Sunday for all of us to bet on. The winner is whoever picks the most games correctly.

## League Structure

- Exactly 5 players, one per NL Central team
- Each player is permanently assigned a team by the league admin during initial setup
- One league admin manages invites, setup, and team assignments

## Desired Functionality

I would like to develop a text message based interface that will provide weekly updates of progress toward the two season long bets and then select one weekly "bet manager" to pick 3 games for the group to bet.

The interface should have a basic web management mode but it should primarily be text message based.

The system should only accept texts from known user numbers to avoid abuse. One league admin can invite the initial set of users.

The system should prompt the league admin to select a desired MLB division and then assign each player and their phone number a team.

Eventually we should extend this system to be more flexible to be any sports season or game but just baseball will be fine to start. The sport, division, and game source should be swappable.

## Weekly Schedule & Timing

- **Sunday morning**: System sends weekly standings update texts to all players covering both season-long bets
- **Sunday**: System selects that week's bet manager via fixed round-robin rotation and prompts them to pick 3 games
- The bet manager picks 3 games from Monday–Saturday of the upcoming week. Sunday games are **not** eligible.
- Once games are selected, all players are prompted to submit their picks (straight winner — no spreads or run lines)
- All picks must be submitted before the first selected game's start time
- Players who haven't picked receive one reminder text

## Game Picking SMS Flow

- The system sends the bet manager a list of available MLB games organized by day (Mon–Sat), including projected starting pitchers where available
- The bet manager replies with their 3 game selections
- The system confirms the selections and notifies all players of the games to pick

## Scoring & Results

- The system automatically checks MLB game results and updates pick records and standings — no manual entry needed
- **Weekly pick winner**: whoever picks the most games correctly out of 3
- **Season-long bet #1 (over/under)**: each player's team win total is tracked against the beginning-of-season over/under line. The player whose team most outperforms their line wins.
- **Season-long bet #2 (total wins)**: raw team win totals compared across the 5 players. Most wins takes it.

## Web Chat Interface

A browser-based chat interface mirrors the SMS conversational flow for testing and as an alternative to text messaging. Users select their player identity and interact with the same conversation engine (AI parsing, game picking, pick submission) via a chat window. This allows full end-to-end testing without a Twilio connection.

## Data Sources

- **MLB schedule & game results**: MLB Stats API (free, no auth required)
- **Starting pitchers**: MLB Stats API probable pitchers endpoint
- **Over/under win totals**: odds API (e.g., The Odds API) for preseason consensus lines

## Tech Stack

- **Backend**: Node.js with TypeScript, deployed on Cloudflare Workers
- **SMS**: Twilio
- **Web admin**: React (lightweight management interface), hosted on Cloudflare
- **Database**: TBD (needs to store users, teams, picks, game results, standings)