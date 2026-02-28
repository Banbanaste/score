/**
 * Frontend API layer for the Tic-Tac-Toe game.
 * Configure API_BASE_URL when the backend is ready; recordMove() will then
 * send player + move data to the backend.
 */

const API_BASE_URL = ""; // Set e.g. "/api" or "https://your-backend.com" when backend is ready

/**
 * Payload shape for one recorded move (frontend → backend).
 * @typedef {Object} MovePayload
 * @property {string} player - "X" or "O"
 * @property {number} cellIndex - 0–8
 * @property {string} position - Human-readable position, e.g. "center", "top left"
 */

/**
 * Record a move so it can be stored in the backend.
 * Called from the game whenever a player (or AI) places a mark.
 * No-op until API_BASE_URL is set and the backend endpoint exists.
 *
 * @param {MovePayload} payload - { player, cellIndex, position }
 */
export function recordMove(payload) {
    if (!API_BASE_URL) {
        // Pipeline in place; backend not configured yet
        if (typeof console !== "undefined" && console.debug) {
            console.debug("[TicTacToe] Move (backend not configured):", payload);
        }
        return Promise.resolve();
    }

    const url = `${API_BASE_URL.replace(/\/$/, "")}/moves`;
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
        .then((res) => {
            if (!res.ok) throw new Error(`Record move failed: ${res.status}`);
            return res;
        })
        .catch((err) => {
            console.warn("[TicTacToe] recordMove error:", err);
        });
}
