import { recordMove } from "./api.js";

const cells = document.querySelectorAll(".cell");
const turn = document.querySelector("#turn");
const restart = document.querySelector("#restart");
const modeSelector = document.querySelector("#mode");
const moveList = document.querySelector("#move-list");

const positionNames = [
    "top left", "top center", "top right",
    "middle left", "center", "middle right",
    "bottom left", "bottom center", "bottom right"
];

const win = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];
let options = ["", "", "", "", "", "", "", "", ""];
let currplayer = "X";
let running = true;
let mode = "human";

start();

function start() {
    cells.forEach((cell) => cell.addEventListener("click", clicked));
    restart.addEventListener("click", restarting);
    modeSelector.addEventListener("change", changeMode);
    turn.textContent = `${currplayer}'s Turn`;
}

function changeMode() {
    mode = modeSelector.value;
    restarting();
}

function clicked() {
    const cellIndex = this.getAttribute("cellIndex");

    if (options[cellIndex] != "" || !running) {
        return;
    }
    update(this, cellIndex);
    checkwinner();

    if (mode === "ai" && currplayer === "O" && running) {
        setTimeout(aiMove, 0);
    } else if (mode === "normalai" && currplayer === "O" && running) {
        setTimeout(normalaiMove, 0);
    }
}

function update(cell, index) {
    options[index] = currplayer;
    const mark = cell.querySelector(".cell-mark");
    mark.textContent = currplayer;
    mark.classList.add(currplayer == "X" ? "red" : "blue");
    addMoveToLog(currplayer, index);
}

function addMoveToLog(player, cellIndex) {
    const position = positionNames[cellIndex];
    const item = document.createElement("li");
    item.textContent = `${player}: ${position}`;
    item.classList.add(player === "X" ? "red" : "blue");
    moveList.appendChild(item);

    // Send move to backend (no-op until API_BASE_URL is set in api.js)
    recordMove({ player, cellIndex, position });
}

function changeplayer() {
    currplayer = currplayer == "X" ? "O" : "X";
    turn.textContent = `${currplayer}'s Turn`;
}

function checkwinner() {
    let roundwon = false;
    for (let i = 0; i < win.length; i++) {
        const condition = win[i];
        const cellA = options[condition[0]];
        const cellB = options[condition[1]];
        const cellC = options[condition[2]];

        if (cellA == "" || cellB == "" || cellC == "") {
            continue;
        }
        if (cellA == cellB && cellB == cellC) {
            roundwon = true;
            break;
        }
    }
    if (roundwon) {
        turn.textContent = `${currplayer} Won!!`;
        running = false;
    } else if (!options.includes("")) {
        turn.textContent = `Draw!!`;
        running = false;
    } else {
        changeplayer();
    }
}

function restarting() {
    currplayer = "X";
    options = ["", "", "", "", "", "", "", "", ""];
    turn.textContent = `${currplayer}'s Turn`;
    cells.forEach((cell) => {
        const mark = cell.querySelector(".cell-mark");
        mark.textContent = "";
        mark.classList.remove("red", "blue");
    });
    moveList.innerHTML = "";
    running = true;
}

function aiMove() {
    const bestMove = minimax(options, currplayer);
    const cell = cells[bestMove.index];
    update(cell, bestMove.index);
    checkwinner();
}

function minimax(newOptions, player) {
    const availSpots = newOptions
        .map((val, index) => (val === "" ? index : null))
        .filter((val) => val !== null);

    if (checkWin(newOptions, "X")) {
        return { score: -10 };
    } else if (checkWin(newOptions, "O")) {
        return { score: 10 };
    } else if (availSpots.length === 0) {
        return { score: 0 };
    }

    const moves = [];
    for (let i = 0; i < availSpots.length; i++) {
        const move = {};
        move.index = availSpots[i];
        newOptions[availSpots[i]] = player;

        if (player === "O") {
            const result = minimax(newOptions, "X");
            move.score = result.score;
        } else {
            const result = minimax(newOptions, "O");
            move.score = result.score;
        }

        newOptions[availSpots[i]] = "";
        moves.push(move);
    }

    let bestMove;
    if (player === "O") {
        let bestScore = -10000;
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].score > bestScore) {
                bestScore = moves[i].score;
                bestMove = i;
            }
        }
    } else {
        let bestScore = 10000;
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].score < bestScore) {
                bestScore = moves[i].score;
                bestMove = i;
            }
        }
    }

    return moves[bestMove];
}

function checkWin(board, player) {
    for (let i = 0; i < win.length; i++) {
        const condition = win[i];
        const cellA = board[condition[0]];
        const cellB = board[condition[1]];
        const cellC = board[condition[2]];

        if (cellA == player && cellB == player && cellC == player) {
            return true;
        }
    }
    return false;
}

function normalaiMove() {
    const emptyCells = options
        .map((value, index) => (value === "" ? index : null))
        .filter((val) => val !== null);

    const randomIndex =
        emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const cell = cells[randomIndex];
    update(cell, randomIndex);
    checkwinner();
}
