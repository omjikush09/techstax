# TechStax GitHub Webhook Receiver

A FastAPI application that receives GitHub webhook events (Push, Pull Request, Merge) and stores them in MongoDB. Includes a real-time UI dashboard that polls for updates every 15 seconds.

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌────────────┐
│   action-repo   │────▶│  webhook-repo    │────▶│   MongoDB   │◀────│     UI     │
│  (GitHub Repo)  │     │  (FastAPI App)   │     │  (Database) │     │ (Polling)  │
└─────────────────┘     └──────────────────┘     └─────────────┘     └────────────┘
     Webhooks              Webhook Receiver         Data Store        15s Polling
```

## 📋 Features

- **Webhook Receiver**: Handles GitHub webhooks for Push, Pull Request, and Merge events
- **MongoDB Storage**: Stores events with proper schema (author, action, from_branch, to_branch, timestamp)
- **Real-time UI**: Polls MongoDB every 15 seconds for new events
- **Smart Updates**: Only displays new events, avoiding duplicates
- **Date Formatting**: Properly formats timestamps (e.g., "1st April 2021 - 9:30 PM UTC")
- **Event Filtering**: Filter by event type (Push, PR, Merge)
- **Modern Design**: Glassmorphism effects, animations, and responsive layout

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- ngrok (for exposing local server to GitHub)

### Option 1: Using Docker Compose (Recommended)

1. **Clone the repository:**

   ```bash
   git clone <your-webhook-repo-url>
   cd webhook-repo
   ```

2. **Start the entire stack:**

   ```bash
   docker-compose up -d
   ```

   This starts both MongoDB and the webhook receiver application.

3. **View logs:**

   ```bash
   docker-compose logs -f webhook-receiver
   ```

4. **Access the dashboard:** http://localhost:8000

5. **Expose with ngrok (for GitHub webhooks):**
   ```bash
   ngrok http 8000
   ```

### Option 2: Local Development (with uv)

1. **Install dependencies:**

   ```bash
   uv sync
   ```

2. **Start MongoDB only:**

   ```bash
   docker-compose up -d mongodb
   ```

3. **Run the application locally:**

   ```bash
   uv run python main.py
   # Or with hot reload:
   uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

## 🔗 GitHub Webhook Setup (action-repo)

1. Create a new repository called `action-repo` on GitHub
2. Go to **Settings** → **Webhooks** → **Add webhook**
3. Configure:
   - **Payload URL**: `https://your-ngrok-url.ngrok.io/webhook/github`
   - **Content type**: `application/json`
   - **Events**: Select "Let me select individual events"
     - ✅ Pushes
     - ✅ Pull requests
4. Save the webhook

## 📡 API Endpoints

| Method | Endpoint          | Description                                      |
| ------ | ----------------- | ------------------------------------------------ |
| `GET`  | `/`               | Serves the UI dashboard                          |
| `POST` | `/webhook/github` | Receives GitHub webhook events                   |
| `GET`  | `/api/events`     | Fetches events (with optional `since` parameter) |
| `GET`  | `/api/health`     | Health check endpoint                            |

### Query Parameters for `/api/events`

| Parameter | Type    | Description                                      |
| --------- | ------- | ------------------------------------------------ |
| `since`   | string  | ISO timestamp to fetch events after this time    |
| `limit`   | integer | Maximum number of events to return (default: 50) |

## 📊 MongoDB Schema

| Column        | Type   | Description                           |
| ------------- | ------ | ------------------------------------- |
| `author`      | string | Name of the GitHub user               |
| `action`      | string | Enum: "PUSH", "PULL_REQUEST", "MERGE" |
| `from_branch` | string | Source branch (for PR/Merge)          |
| `to_branch`   | string | Target branch                         |
| `timestamp`   | string | UTC datetime string                   |

## 🎨 UI Event Formats

- **PUSH**: `"Travis" pushed to "staging" on 1st April 2021 - 9:30 PM UTC`
- **PULL_REQUEST**: `"Travis" submitted a pull request from "staging" to "master" on 1st April 2021 - 9:00 AM UTC`
- **MERGE**: `"Travis" merged branch "dev" to "master" on 2nd April 2021 - 12:00 PM UTC`

## 📁 Project Structure

```
webhook-repo/
├── main.py              # FastAPI application
├── pyproject.toml       # Project config & dependencies (uv)
├── uv.lock              # Lock file for reproducible builds
├── .env.example         # Environment variables template
├── README.md            # This file
├── static/
│   ├── index.html       # UI dashboard
│   ├── styles.css       # Modern CSS styles
│   └── app.js           # Frontend JavaScript
├── Dockerfile           # Container support
└── docker-compose.yml   # Docker setup (optional)
```

## 🐳 Docker Support (Optional)

```bash
docker-compose up -d
```

## 📝 Repository Links

- **action-repo**: [GitHub Actions Repository] - Dummy repo for triggering webhooks
- **webhook-repo**: [Webhook Receiver] - This repository with backend + UI code

## 🧪 Testing

1. Make a push to `action-repo`
2. Create a pull request in `action-repo`
3. Merge the pull request
4. Observe events appearing in the UI dashboard

## 📄 License

MIT License
