"""
TechStax GitHub Webhook Receiver
================================
FastAPI application that receives GitHub webhook events (Push, Pull Request, Merge)
and stores them in MongoDB for UI consumption.

Author: TechStax Developer Assessment
"""

from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone
from enum import Enum
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging

# ==============================================================================
# Configuration & Logging
# ==============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# MongoDB Configuration
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "github_events")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "events")

# ==============================================================================
# Enums and Models
# ==============================================================================

class ActionType(str, Enum):
    """
    Enum representing the types of GitHub actions we track.
    """
    PUSH = "PUSH"
    PULL_REQUEST = "PULL_REQUEST"
    MERGE = "MERGE"


class GitHubEvent(BaseModel):
    """
    Pydantic model for GitHub events stored in MongoDB.
    
    Attributes:
        author: Name of the GitHub user making the action
        action: Type of GitHub action (PUSH, PULL_REQUEST, MERGE)
        from_branch: Source branch (used in PR and Merge)
        to_branch: Target branch
        timestamp: UTC datetime string of when the action occurred
    """
    author: str = Field(..., description="Name of the GitHub user making the action")
    action: ActionType = Field(..., description="Type of GitHub action")
    from_branch: Optional[str] = Field(None, description="Source branch for PR/Merge")
    to_branch: str = Field(..., description="Target branch")
    timestamp: str = Field(..., description="UTC datetime string of the action")

    class Config:
        use_enum_values = True


class EventResponse(BaseModel):
    """
    Response model for API endpoints returning events.
    """
    id: str
    author: str
    action: str
    from_branch: Optional[str]
    to_branch: str
    timestamp: str
    formatted_message: str


# ==============================================================================
# FastAPI Application Setup
# ==============================================================================

app = FastAPI(
    title="TechStax GitHub Webhook Receiver",
    description="Receives GitHub webhook events and stores them in MongoDB",
    version="1.0.0"
)

# CORS middleware for UI access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# Database Connection
# ==============================================================================

# MongoDB client instance (initialized on startup)
mongo_client: Optional[AsyncIOMotorClient] = None
database = None
collection = None


@app.on_event("startup")
async def startup_db_client():
    """
    Initialize MongoDB connection on application startup.
    """
    global mongo_client, database, collection
    try:
        mongo_client = AsyncIOMotorClient(MONGO_URI)
        database = mongo_client[DATABASE_NAME]
        collection = database[COLLECTION_NAME]
        
        # Create index on timestamp for efficient queries
        await collection.create_index("timestamp", background=True)
        
        logger.info(f"Connected to MongoDB at {MONGO_URI}")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_db_client():
    """
    Close MongoDB connection on application shutdown.
    """
    global mongo_client
    if mongo_client:
        mongo_client.close()
        logger.info("MongoDB connection closed")


# ==============================================================================
# Helper Functions
# ==============================================================================

def format_timestamp(timestamp_str: str) -> str:
    """
    Format a timestamp string into a human-readable format.
    
    Args:
        timestamp_str: ISO format datetime string
        
    Returns:
        Formatted string like "1st April 2021 - 9:30 PM UTC"
    """
    try:
        dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
    except ValueError:
        # Try parsing as a regular datetime string
        try:
            dt = datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%S")
            dt = dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return timestamp_str  # Return as-is if parsing fails
    
    # Get day with ordinal suffix
    day = dt.day
    if 4 <= day <= 20 or 24 <= day <= 30:
        suffix = "th"
    else:
        suffix = ["st", "nd", "rd"][day % 10 - 1]
    
    # Format the datetime
    formatted = dt.strftime(f"{day}{suffix} %B %Y - %I:%M %p UTC")
    return formatted


def create_formatted_message(event: dict) -> str:
    """
    Create a formatted message based on the event type.
    
    Args:
        event: Dictionary containing event data
        
    Returns:
        Formatted message string
    """
    author = event.get("author", "Unknown")
    action = event.get("action", "")
    from_branch = event.get("from_branch", "")
    to_branch = event.get("to_branch", "")
    timestamp = format_timestamp(event.get("timestamp", ""))
    
    if action == ActionType.PUSH.value:
        # Format: {author} pushed to {to_branch} on {timestamp}
        return f'"{author}" pushed to "{to_branch}" on {timestamp}'
    
    elif action == ActionType.PULL_REQUEST.value:
        # Format: {author} submitted a pull request from {from_branch} to {to_branch} on {timestamp}
        return f'"{author}" submitted a pull request from "{from_branch}" to "{to_branch}" on {timestamp}'
    
    elif action == ActionType.MERGE.value:
        # Format: {author} merged branch {from_branch} to {to_branch} on {timestamp}
        return f'"{author}" merged branch "{from_branch}" to "{to_branch}" on {timestamp}'
    
    return f"Unknown action by {author}"


def extract_push_event(payload: dict) -> Optional[GitHubEvent]:
    """
    Extract push event data from GitHub webhook payload.
    
    Args:
        payload: GitHub webhook payload
        
    Returns:
        GitHubEvent object or None if extraction fails
    """
    try:
        # Get the pusher/author
        author = payload.get("pusher", {}).get("name", "")
        if not author:
            author = payload.get("sender", {}).get("login", "Unknown")
        
        # Get the branch (refs/heads/branch_name)
        ref = payload.get("ref", "")
        to_branch = ref.replace("refs/heads/", "") if ref else "unknown"
        
        # Get timestamp
        head_commit = payload.get("head_commit", {})
        timestamp = head_commit.get("timestamp", datetime.now(timezone.utc).isoformat())
        
        return GitHubEvent(
            author=author,
            action=ActionType.PUSH,
            from_branch=None,
            to_branch=to_branch,
            timestamp=timestamp
        )
    except Exception as e:
        logger.error(f"Error extracting push event: {e}")
        return None


def extract_pull_request_event(payload: dict) -> Optional[GitHubEvent]:
    """
    Extract pull request event data from GitHub webhook payload.
    Handles both PR creation and merge events.
    
    Args:
        payload: GitHub webhook payload
        
    Returns:
        GitHubEvent object or None if extraction fails
    """
    try:
        pr_action = payload.get("action", "")
        pull_request = payload.get("pull_request", {})
        
        # Get author
        author = pull_request.get("user", {}).get("login", "")
        if not author:
            author = payload.get("sender", {}).get("login", "Unknown")
        
        # Get branches
        head = pull_request.get("head", {})
        base = pull_request.get("base", {})
        from_branch = head.get("ref", "unknown")
        to_branch = base.get("ref", "unknown")
        
        # Determine if this is a merge or a regular PR
        # A merge event is when action is "closed" and merged is true
        is_merged = pull_request.get("merged", False)
        merged_at = pull_request.get("merged_at")
        
        if pr_action == "closed" and is_merged and merged_at:
            # This is a MERGE event
            # Use the merger's login if available
            merged_by = pull_request.get("merged_by", {}).get("login", author)
            return GitHubEvent(
                author=merged_by,
                action=ActionType.MERGE,
                from_branch=from_branch,
                to_branch=to_branch,
                timestamp=merged_at
            )
        elif pr_action == "opened" or pr_action == "reopened":
            # This is a PULL_REQUEST event
            created_at = pull_request.get("created_at", datetime.now(timezone.utc).isoformat())
            return GitHubEvent(
                author=author,
                action=ActionType.PULL_REQUEST,
                from_branch=from_branch,
                to_branch=to_branch,
                timestamp=created_at
            )
        
        return None  # Ignore other PR actions
        
    except Exception as e:
        logger.error(f"Error extracting pull request event: {e}")
        return None


# ==============================================================================
# API Endpoints
# ==============================================================================

@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    """
    Serve the main UI page.
    """
    return FileResponse("static/index.html")


@app.post("/webhook/github", status_code=status.HTTP_201_CREATED)
async def receive_github_webhook(request: Request):
    """
    Receive and process GitHub webhook events.
    
    This endpoint handles:
    - Push events: When code is pushed to a branch
    - Pull Request events: When a PR is opened/reopened
    - Merge events: When a PR is merged (closed with merged=true)
    
    Args:
        request: FastAPI Request object containing the webhook payload
        
    Returns:
        Dictionary with status and event details
    """
    try:
        payload = await request.json()
        
        # Get the GitHub event type from headers
        github_event = request.headers.get("X-GitHub-Event", "")
        logger.info(f"Received GitHub event: {github_event}")
        
        event: Optional[GitHubEvent] = None
        
        # Process based on event type
        if github_event == "push":
            event = extract_push_event(payload)
            
        elif github_event == "pull_request":
            event = extract_pull_request_event(payload)
            
        else:
            logger.info(f"Ignoring unsupported event type: {github_event}")
            return {
                "status": "ignored",
                "message": f"Event type '{github_event}' is not supported"
            }
        
        # Store event in MongoDB if valid
        if event:
            event_dict = event.model_dump()
            result = await collection.insert_one(event_dict)
            
            logger.info(f"Stored event: {event.action} by {event.author}")
            
            return {
                "status": "success",
                "message": "Event processed and stored",
                "event_id": str(result.inserted_id),
                "author": event.author,
                "action": event.action.value if hasattr(event.action, 'value') else str(event.action),
                "to_branch": event.to_branch
            }
        else:
            return {
                "status": "ignored",
                "message": "Event did not match criteria for storage"
            }
            
    except Exception as e:
        logger.error(f"Error processing webhook: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process webhook: {str(e)}"
        )


@app.get("/api/events", response_model=List[EventResponse])
async def get_events(
    since: Optional[str] = None,
    limit: int = 50
):
    """
    Get GitHub events from MongoDB.
    
    This endpoint is used by the UI to poll for new events every 15 seconds.
    
    Args:
        since: ISO format datetime string to filter events after this time.
               Used to avoid fetching already-displayed events.
        limit: Maximum number of events to return (default: 50)
        
    Returns:
        List of EventResponse objects with formatted messages
    """
    try:
        # Build query filter
        query = {}
        
        # Filter events after the 'since' timestamp if provided
        if since:
            query["timestamp"] = {"$gt": since}
        
        # Fetch events sorted by timestamp (newest first)
        cursor = collection.find(query).sort("timestamp", -1).limit(limit)
        events = await cursor.to_list(length=limit)
        
        # Transform to response format
        response_events = []
        for event in events:
            response_events.append(EventResponse(
                id=str(event["_id"]),
                author=event.get("author", "Unknown"),
                action=event.get("action", "UNKNOWN"),
                from_branch=event.get("from_branch"),
                to_branch=event.get("to_branch", ""),
                timestamp=event.get("timestamp", ""),
                formatted_message=create_formatted_message(event)
            ))
        
        return response_events
        
    except Exception as e:
        logger.error(f"Error fetching events: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch events: {str(e)}"
        )


@app.get("/api/health")
async def health_check():
    """
    Health check endpoint for monitoring.
    
    Returns:
        Status of the application and database connection
    """
    try:
        # Check MongoDB connection
        await mongo_client.admin.command('ping')
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    
    return {
        "status": "healthy",
        "database": db_status,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# Mount static files (for UI assets)
# This is done after route definitions to avoid conflicts
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Testing webhook
print("test")
# ==============================================================================
# Main Entry Point
# ==============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
