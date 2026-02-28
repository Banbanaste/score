"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIN_LINES = void 0;
exports.checkWin = checkWin;
exports.checkDraw = checkDraw;
exports.checkGameResult = checkGameResult;
exports.isValidCell = isValidCell;
exports.isCellEmpty = isCellEmpty;
exports.placeMarker = placeMarker;
exports.countImminentWins = countImminentWins;
exports.isDrawForced = isDrawForced;
/**
 * All 8 possible winning lines in tic-tac-toe.
 * Each line is represented as a tuple of 3 cell indices (0-8).
 */
exports.WIN_LINES = [
    // Rows
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    // Columns
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    // Diagonals
    [0, 4, 8],
    [2, 4, 6],
];
/**
 * Checks if the board has a winning line.
 * Pure function - does not modify the board.
 * @param board - The current game board
 * @returns WinResult with winner and winning cells, or null if no winner
 */
function checkWin(board) {
    for (const line of exports.WIN_LINES) {
        const [a, b, c] = line;
        const cellA = board[a];
        const cellB = board[b];
        const cellC = board[c];
        if (cellA !== null && cellA === cellB && cellA === cellC) {
            return {
                winner: cellA,
                winningCells: [a, b, c],
            };
        }
    }
    return null;
}
/**
 * Checks if the game is a draw (all cells filled with no winner).
 * Pure function - does not modify the board.
 * @param board - The current game board
 * @returns true if all cells are filled, false otherwise
 */
function checkDraw(board) {
    return board.every((cell) => cell !== null);
}
/**
 * Checks the game result (win or draw).
 * Pure function - does not modify the board.
 * @param board - The current game board
 * @returns GameResult with winner info, or null if game is still in progress
 */
function checkGameResult(board) {
    const winResult = checkWin(board);
    if (winResult !== null) {
        return winResult;
    }
    if (checkDraw(board)) {
        return { winner: 'draw' };
    }
    return null;
}
/**
 * Validates that a cell index is within the valid range (0-8).
 * Pure function.
 * @param cell - The cell index to validate
 * @returns true if cell is a valid integer between 0 and 8
 */
function isValidCell(cell) {
    return Number.isInteger(cell) && cell >= 0 && cell <= 8;
}
/**
 * Checks if a cell is empty (null).
 * Pure function - does not modify the board.
 * @param board - The current game board
 * @param cell - The cell index to check
 * @returns true if the cell is empty, false otherwise
 */
function isCellEmpty(board, cell) {
    return board[cell] === null;
}
/**
 * Places a marker on the board at the specified cell.
 * Pure function - returns a NEW board without modifying the original.
 * @param board - The current game board
 * @param cell - The cell index where to place the marker
 * @param mark - The mark to place ('X' or 'O')
 * @returns A new board with the marker placed
 */
function placeMarker(board, cell, mark) {
    const newBoard = [...board];
    newBoard[cell] = mark;
    return newBoard;
}
/**
 * Counts how many winning lines have exactly 2 of the given mark and 1 empty cell.
 * This indicates imminent win opportunities for the player.
 * Pure function - does not modify the board.
 * @param board - The current game board
 * @param mark - The mark to check for ('X' or 'O')
 * @returns Number of lines where the player is one move away from winning
 */
function countImminentWins(board, mark) {
    let count = 0;
    for (const line of exports.WIN_LINES) {
        const [a, b, c] = line;
        const cells = [board[a], board[b], board[c]];
        const markCount = cells.filter((cell) => cell === mark).length;
        const emptyCount = cells.filter((cell) => cell === null).length;
        if (markCount === 2 && emptyCount === 1) {
            count++;
        }
    }
    return count;
}
/**
 * Determines if a draw is forced (no winning paths remain for either player).
 * Pure function - does not modify the board.
 * @param board - The current game board
 * @returns true if neither player can win from this position
 */
function isDrawForced(board) {
    for (const line of exports.WIN_LINES) {
        const [a, b, c] = line;
        const cells = [board[a], board[b], board[c]];
        const hasX = cells.some((cell) => cell === 'X');
        const hasO = cells.some((cell) => cell === 'O');
        // If a line has both X and O, it's blocked
        // If a line has only X or only O (or empty), it's still a potential winning path
        if (!hasX || !hasO) {
            return false;
        }
    }
    // All lines are blocked - draw is forced
    return true;
}
