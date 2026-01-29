/**
 * TechStax GitHub Events Dashboard - JavaScript
 * ==============================================
 * Handles polling for events, UI updates, and filtering.
 * Polls MongoDB every 15 seconds and displays new events only.
 *
 * Key Features:
 * - 15-second polling interval
 * - Tracks displayed events to avoid duplicates
 * - Handles date formatting correctly
 * - Filter by event type
 */

// ==============================================================================
// Configuration Constants
// ==============================================================================

/** Polling interval in milliseconds (15 seconds as per requirement) */
const POLL_INTERVAL_MS = 15000;

/** API endpoint for fetching events */
const API_EVENTS_URL = "/api/events";

/** API endpoint for health check */
const API_HEALTH_URL = "/api/health";

// ==============================================================================
// State Management
// ==============================================================================

/**
 * Application state object
 * Tracks displayed events and current filter
 */
const appState = {
	/** Set of event IDs that have been displayed to avoid duplicates */
	displayedEventIds: new Set(),

	/** Timestamp of the last fetched event for incremental fetching */
	lastEventTimestamp: null,

	/** Current filter type ('all', 'PUSH', 'PULL_REQUEST', 'MERGE') */
	currentFilter: "all",

	/** Array of all events for filtering */
	allEvents: [],

	/** Statistics counters */
	stats: {
		total: 0,
		push: 0,
		pr: 0,
		merge: 0,
	},

	/** Polling timer reference */
	pollTimer: null,

	/** Countdown value for UI display */
	countdown: 15,

	/** Countdown timer reference */
	countdownTimer: null,
};

// ==============================================================================
// DOM Element References
// ==============================================================================

/**
 * Cache DOM elements for performance
 */
const domElements = {
	statusIndicator: document.getElementById("status-indicator"),
	statusText: document.querySelector(".status-text"),
	countdown: document.getElementById("countdown"),
	eventsList: document.getElementById("events-list"),
	emptyState: document.getElementById("empty-state"),
	totalCount: document.getElementById("total-count"),
	pushCount: document.getElementById("push-count"),
	prCount: document.getElementById("pr-count"),
	mergeCount: document.getElementById("merge-count"),
	filterButtons: document.querySelectorAll(".filter-btn"),
};

// ==============================================================================
// Utility Functions
// ==============================================================================

/**
 * Format a timestamp string into human-readable format.
 * Example: "1st April 2021 - 9:30 PM UTC"
 *
 * @param {string} timestampStr - ISO format datetime string
 * @returns {string} Formatted date string
 */
function formatTimestamp(timestampStr) {
	try {
		const date = new Date(timestampStr);

		if (isNaN(date.getTime())) {
			console.warn("Invalid timestamp:", timestampStr);
			return timestampStr;
		}

		// Get day with ordinal suffix
		const day = date.getUTCDate();
		const suffix = getOrdinalSuffix(day);

		// Month names
		const months = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];

		// Format hours for 12-hour clock
		let hours = date.getUTCHours();
		const ampm = hours >= 12 ? "PM" : "AM";
		hours = hours % 12 || 12;

		// Format minutes with leading zero
		const minutes = date.getUTCMinutes().toString().padStart(2, "0");

		return `${day}${suffix} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} - ${hours}:${minutes} ${ampm} UTC`;
	} catch (error) {
		console.error("Error formatting timestamp:", error);
		return timestampStr;
	}
}

/**
 * Get ordinal suffix for a day number.
 *
 * @param {number} day - Day of month
 * @returns {string} Ordinal suffix (st, nd, rd, th)
 */
function getOrdinalSuffix(day) {
	if (day >= 11 && day <= 13) {
		return "th";
	}

	switch (day % 10) {
		case 1:
			return "st";
		case 2:
			return "nd";
		case 3:
			return "rd";
		default:
			return "th";
	}
}

/**
 * Create formatted message based on event type.
 * Follows the exact format specified in requirements.
 *
 * @param {Object} event - Event object
 * @returns {string} HTML formatted message
 */
function createFormattedMessage(event) {
	const author = event.author || "Unknown";
	const fromBranch = event.from_branch || "";
	const toBranch = event.to_branch || "";
	const timestamp = formatTimestamp(event.timestamp);

	switch (event.action) {
		case "PUSH":
			// Format: {author} pushed to {to_branch} on {timestamp}
			return `<span class="author">"${author}"</span> pushed to <span class="branch">"${toBranch}"</span> on <span class="timestamp">${timestamp}</span>`;

		case "PULL_REQUEST":
			// Format: {author} submitted a pull request from {from_branch} to {to_branch} on {timestamp}
			return `<span class="author">"${author}"</span> submitted a pull request from <span class="branch">"${fromBranch}"</span> to <span class="branch">"${toBranch}"</span> on <span class="timestamp">${timestamp}</span>`;

		case "MERGE":
			// Format: {author} merged branch {from_branch} to {to_branch} on {timestamp}
			return `<span class="author">"${author}"</span> merged branch <span class="branch">"${fromBranch}"</span> to <span class="branch">"${toBranch}"</span> on <span class="timestamp">${timestamp}</span>`;

		default:
			return `Unknown action by <span class="author">"${author}"</span>`;
	}
}

/**
 * Get relative time string for display.
 *
 * @param {string} timestampStr - ISO format datetime string
 * @returns {string} Relative time (e.g., "2 min ago")
 */
function getRelativeTime(timestampStr) {
	try {
		const date = new Date(timestampStr);
		const now = new Date();
		const diffMs = now - date;
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHour = Math.floor(diffMin / 60);
		const diffDay = Math.floor(diffHour / 24);

		if (diffSec < 60) return "Just now";
		if (diffMin < 60) return `${diffMin} min ago`;
		if (diffHour < 24) return `${diffHour} hr ago`;
		return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
	} catch (error) {
		return "";
	}
}

// ==============================================================================
// API Functions
// ==============================================================================

/**
 * Fetch events from the API.
 * Uses 'since' parameter to only fetch new events.
 *
 * @returns {Promise<Array>} Array of event objects
 */
async function fetchEvents() {
	try {
		let url = API_EVENTS_URL;

		// Add 'since' parameter to only get new events (avoid duplicates)
		if (appState.lastEventTimestamp) {
			url += `?since=${encodeURIComponent(appState.lastEventTimestamp)}`;
		}

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const events = await response.json();
		return events;
	} catch (error) {
		console.error("Error fetching events:", error);
		updateConnectionStatus("error");
		return [];
	}
}

/**
 * Check API health status.
 *
 * @returns {Promise<boolean>} True if healthy
 */
async function checkHealth() {
	try {
		const response = await fetch(API_HEALTH_URL);
		return response.ok;
	} catch (error) {
		console.error("Health check failed:", error);
		return false;
	}
}

// ==============================================================================
// UI Update Functions
// ==============================================================================

/**
 * Update connection status indicator.
 *
 * @param {string} status - 'connected', 'connecting', or 'error'
 */
function updateConnectionStatus(status) {
	const { statusIndicator, statusText } = domElements;

	// Remove existing status classes
	statusIndicator.classList.remove("connected", "error");

	switch (status) {
		case "connected":
			statusIndicator.classList.add("connected");
			statusText.textContent = "Connected";
			break;
		case "error":
			statusIndicator.classList.add("error");
			statusText.textContent = "Connection Error";
			break;
		default:
			statusText.textContent = "Connecting...";
	}
}

/**
 * Update statistics display.
 */
function updateStats() {
	const { totalCount, pushCount, prCount, mergeCount } = domElements;

	// Animate number changes
	animateNumber(totalCount, appState.stats.total);
	animateNumber(pushCount, appState.stats.push);
	animateNumber(prCount, appState.stats.pr);
	animateNumber(mergeCount, appState.stats.merge);
}

/**
 * Animate a number change in an element.
 *
 * @param {HTMLElement} element - Element to update
 * @param {number} newValue - New number value
 */
function animateNumber(element, newValue) {
	const currentValue = parseInt(element.textContent) || 0;

	if (currentValue === newValue) return;

	// Simple animation
	element.textContent = newValue;
	element.style.transform = "scale(1.2)";
	element.style.transition = "transform 0.2s ease";

	setTimeout(() => {
		element.style.transform = "scale(1)";
	}, 200);
}

/**
 * Create HTML for an event card.
 *
 * @param {Object} event - Event object
 * @param {boolean} isNew - Whether this is a new event (for animation)
 * @returns {string} HTML string
 */
function createEventCardHTML(event, isNew = false) {
	const actionClass = event.action.toLowerCase();
	const formattedMessage = createFormattedMessage(event);
	const relativeTime = getRelativeTime(event.timestamp);
	const newClass = isNew ? "new-event" : "";

	return `
        <div class="event-card ${newClass}" data-id="${event.id}" data-action="${event.action}">
            <span class="event-type-badge ${actionClass}">${event.action.replace("_", " ")}</span>
            <div class="event-content">
                <p class="event-message">${formattedMessage}</p>
            </div>
            <span class="event-time">${relativeTime}</span>
        </div>
    `;
}

/**
 * Add new events to the UI.
 * Only adds events that haven't been displayed yet.
 *
 * @param {Array} events - Array of event objects
 */
function addEventsToUI(events) {
	const { eventsList, emptyState } = domElements;

	// Filter out already displayed events
	const newEvents = events.filter(
		(event) => !appState.displayedEventIds.has(event.id),
	);

	if (newEvents.length === 0) {
		return; // No new events to display
	}

	// Hide empty state, show events list
	emptyState.classList.add("hidden");
	eventsList.classList.remove("hidden");

	// Sort new events by timestamp (newest first)
	newEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

	// Add each new event
	newEvents.forEach((event) => {
		// Mark as displayed
		appState.displayedEventIds.add(event.id);
		appState.allEvents.unshift(event);

		// Update statistics
		appState.stats.total++;
		switch (event.action) {
			case "PUSH":
				appState.stats.push++;
				break;
			case "PULL_REQUEST":
				appState.stats.pr++;
				break;
			case "MERGE":
				appState.stats.merge++;
				break;
		}

		// Update last timestamp for next fetch
		if (
			!appState.lastEventTimestamp ||
			event.timestamp > appState.lastEventTimestamp
		) {
			appState.lastEventTimestamp = event.timestamp;
		}

		// Create and insert event card
		const cardHTML = createEventCardHTML(event, true);
		eventsList.insertAdjacentHTML("afterbegin", cardHTML);
	});

	// Update stats display
	updateStats();

	// Apply current filter
	applyFilter(appState.currentFilter);
}

/**
 * Apply filter to events list.
 *
 * @param {string} filterType - 'all', 'PUSH', 'PULL_REQUEST', or 'MERGE'
 */
function applyFilter(filterType) {
	appState.currentFilter = filterType;

	const eventCards = document.querySelectorAll(".event-card");

	eventCards.forEach((card) => {
		const action = card.dataset.action;

		if (filterType === "all" || action === filterType) {
			card.classList.remove("hidden");
		} else {
			card.classList.add("hidden");
		}
	});

	// Update active button
	domElements.filterButtons.forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.filter === filterType);
	});
}

/**
 * Update countdown timer display.
 */
function updateCountdown() {
	appState.countdown--;

	if (appState.countdown < 0) {
		appState.countdown = 15;
	}

	domElements.countdown.textContent = appState.countdown;
}

// ==============================================================================
// Polling Functions
// ==============================================================================

/**
 * Poll for new events.
 * Called every 15 seconds.
 */
async function pollForEvents() {
	console.log("Polling for new events...");

	const events = await fetchEvents();

	if (events.length > 0) {
		addEventsToUI(events);
		updateConnectionStatus("connected");
	} else {
		// Check if connection is still healthy
		const isHealthy = await checkHealth();
		updateConnectionStatus(isHealthy ? "connected" : "error");
	}

	// Reset countdown
	appState.countdown = 15;
}

/**
 * Start the polling mechanism.
 */
function startPolling() {
	// Initial fetch
	pollForEvents();

	// Set up polling interval (15 seconds)
	appState.pollTimer = setInterval(pollForEvents, POLL_INTERVAL_MS);

	// Set up countdown timer (1 second)
	appState.countdownTimer = setInterval(updateCountdown, 1000);

	console.log("Polling started with 15-second interval");
}

/**
 * Stop the polling mechanism.
 */
function stopPolling() {
	if (appState.pollTimer) {
		clearInterval(appState.pollTimer);
		appState.pollTimer = null;
	}

	if (appState.countdownTimer) {
		clearInterval(appState.countdownTimer);
		appState.countdownTimer = null;
	}

	console.log("Polling stopped");
}

// ==============================================================================
// Event Listeners
// ==============================================================================

/**
 * Set up event listeners for filter buttons.
 */
function setupEventListeners() {
	domElements.filterButtons.forEach((btn) => {
		btn.addEventListener("click", () => {
			const filterType = btn.dataset.filter;
			applyFilter(filterType);
		});
	});

	// Handle visibility change (pause polling when tab is hidden)
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			stopPolling();
		} else {
			startPolling();
		}
	});
}

// ==============================================================================
// Initialization
// ==============================================================================

/**
 * Initialize the application.
 */
function init() {
	console.log("TechStax GitHub Events Dashboard initializing...");

	// Set up event listeners
	setupEventListeners();

	// Start polling for events
	startPolling();

	console.log("Dashboard initialized successfully");
}

// Start the application when DOM is ready
document.addEventListener("DOMContentLoaded", init);
