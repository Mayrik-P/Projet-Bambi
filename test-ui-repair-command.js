/**
 * Test jsdom dédié — correctif Repair (retour de Mayrik, 28/08,
 * capture des règles p.8) : Repair doit être proposé pour N'IMPORTE
 * QUELLE voiture endommagée (1 ou 2 jetons), pas seulement une
 * voiture déjà inopérable. Sur le vrai bundle navigateur, vrai clic.
 * À lancer avec : node test-ui-repair-command.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }
function panelText(dom) { return dom.window.document.getElementById("panel").textContent; }

section("Test 1 — Repair proposé pour une voiture ENCORE OPÉRABLE avec 1 seul dégât, un 6 dans le pool");

let dom = makeDom();
let win = dom.window;
win.newGame();
const HUMAN = win.eval("HUMAN");
const CAR_SIZE = win.eval("CAR_SIZE");
const CAR_STATUS = win.eval("CAR_STATUS");
let G = win.eval("G");
G.allCars.length = 0;
const myCar = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 0);
myCar.damageTokens = ["dent"]; // 1 seul jeton, toujours opérable
G.allCars.push(myCar);
G.roundState.dicePool[HUMAN] = [6, 4, 4, 1];

let sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = true;
sel.car = myCar;
sel.dieValue = 4;
sel.step = "command";
win.render();

console.log("Le panneau propose bien Repair (attendu true) :", panelText(dom).includes("repair"));
console.log("Aucune mention de dégâts ≥2 ni [INOPÉRABLE] nécessaire — état réel de la voiture :",
  myCar.damageTokens.length, "jeton(s), status:", myCar.status);

section("Test 2 — Choisir Repair puis choisir cette voiture comme cible, via de vrais clics");

// Reclique réellement sur le bouton Repair puis sur la cible.
const buttons = () => [...dom.window.document.querySelectorAll("button")];
const repairBtn = buttons().find((b) => b.textContent.toLowerCase().includes("repair"));
console.log("Bouton Repair trouvé (attendu true) :", !!repairBtn);
repairBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
sel = win.eval("sel");
win.render();
console.log("Étape passée à repair-target (attendu true) :", sel.step === "repair-target");
console.log("Le panneau liste bien la voiture à 1 dégât comme cible (attendu true) :",
  panelText(dom).includes("large"));

const targetBtn = buttons().find((b) => b.textContent.includes("large"));
targetBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
sel = win.eval("sel");
console.log("Commande Repair bien enregistrée avec la bonne cible (attendu true) :",
  sel.command && sel.command.type === "repair" && sel.command.target === myCar);

section("Test 3 — Non-régression : aucun dégât -> pas de Repair proposé, même avec un 6");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const cleanCar = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
G.allCars.push(cleanCar);
G.roundState.dicePool[HUMAN] = [6, 4, 4, 1];
sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = true;
sel.car = cleanCar;
sel.dieValue = 4;
sel.step = "command";
win.render();
console.log("Repair absent (attendu true) :", !panelText(dom).includes("repair"));

console.log("\n=== Fin des tests dédiés (correctif Repair) ===");
