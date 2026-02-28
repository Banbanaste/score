"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyBoard = createEmptyBoard;
exports.toggleTurn = toggleTurn;
function createEmptyBoard() {
    return Array(9).fill(null);
}
function toggleTurn(turn) {
    return turn === 'X' ? 'O' : 'X';
}
