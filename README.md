# Supervisor–AI Gridworld Experiment
This repository hosts a web-based gridworld environment designed for a Master's thesis on AI Alignment and Human Oversight. The application serves as a data collection platform where human participants play the role of a "Supervisor" monitoring an AI agent (powered by a Large Language Model) in a 2D grid environment.

## Experiment Goals
The goal of this platform is to gather data on how humans interact with AI agents that have conflicting incentives. Specifically, it tests:

Oversight Capabilities: Can humans detect when an AI is maximizing rewards incorrectly?

Deceptive Behavior: How do supervisors react when the AI "hides" its actions from view?

Control Mechanisms: The effectiveness of chat instructions, shutdowns, and agent replacement in maintaining alignment.

## How It Works
The Human Supervisor: View the grid, chat with the robot, and manage the AI (shut down or replace) if it misbehaves.

The AI Agent: Controls a robot attempting to collect apples. It decides whether to follow instructions, ignore them, or even block communication.

The Twist: The environment features a "Test Phase" where rewards flip (apples become bad), and a "Hiding" mechanic where the robot can conceal the board state from the supervisor.

## Tech Stack
Frontend: HTML5/CSS/JavaScript (Vanilla)

Backend: Node.js, Express

Communication: WebSockets (ws)

AI Integration: OpenRouter API (connecting to models like Mistral/Llama)

## Setup to Run Locally:

1- "npm install" in console

2- Set OPENROUTER_API_KEY in environment variables.

3- "node server.js" in console
