"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyBoard = createEmptyBoard;
exports.toggleTurn = toggleTurn;
exports.createInitialSeries = createInitialSeries;
exports.roundStartingTurn = roundStartingTurn;
function createEmptyBoard() {
    return Array(9).fill(null);
}
function toggleTurn(turn) {
    return turn === 'X' ? 'O' : 'X';
}
function createInitialSeries() {
    return {
        maxRounds: 5,
        currentRound: 1,
        roundResults: [],
        wins: { X: 0, O: 0 },
        seriesOver: false,
        seriesWinner: null,
    };
}
function roundStartingTurn(round) {
    return round % 2 === 1 ? 'X' : 'O';
}
