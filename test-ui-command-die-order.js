/**
 * Test jsdom dédié — réordonnancement du choix de Command (retour de
 * Mayrik, 28/08) : dé mouvement -> voiture -> DÉ de Command (ou
 * "Aucune") -> TYPE de Command (restreint aux compatibles avec le dé
 * déjà choisi). Sur le vrai bundle navigateur, vrais clics.
 * À lancer avec : node test-ui-command-die-order.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }
function panelText(dom) { return dom.window.document.getElementById("panel").textContent; }
function clickButtonContaining(dom, text) {
  const buttons = [...dom.window.document.querySelectorAll("button")];
  const btn = buttons.find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`Bouton introuvable contenant : "${text}"`);
  btn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  return btn;
}

section("Test 1 — Après avoir choisi la voiture, l'étape suivante est bien le choix du DÉ de Command (pas du type)");

let dom = makeDom();
let win = dom.window;
win.newGame();
const HUMAN = win.eval("HUMAN");
const CAR_SIZE = win.eval("CAR_SIZE");
let G = win.eval("G");
G.allCars.length = 0;
const myCar = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 3, 3);
myCar.damageTokens = ["dent"]; // endommagée, pour que Repair soit une option pertinente au Test 2
G.allCars.push(myCar);
G.roundState.dicePool[HUMAN] = [6, 4, 4, 1]; // dé de mouvement + 3 dés potentiels pour une Command

let sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = true;
sel.step = "die";
win.render();

// Choisit le dé de mouvement (4), puis la voiture.
win.pickDie(4);
sel = win.eval("sel");
win.render();
win.pickCar(myCar);
sel = win.eval("sel");
win.render();

console.log("Étape après le choix de la voiture (attendu 'command-die') :", sel.step);
console.log("Le panneau propose bien de choisir un DÉ, pas un type de Command (attendu true) :", panelText(dom).includes("consacrer"));
console.log("Le panneau ne mentionne aucun nom de Command à ce stade (attendu true) :",
  !panelText(dom).includes("nitro") && !panelText(dom).includes("drift") && !panelText(dom).includes("airstrike"));

section("Test 2 — Choisir le dé 6 -> seules les Commands compatibles avec 6 sont proposées (Repair + Airstrike, pas Nitro/Drift)");

win.pickCommandDieChoice(6);
sel = win.eval("sel");
win.render();

console.log("Étape (attendu 'command') :", sel.step);
console.log("Repair proposé (attendu true — dé 6 et voiture endommagée) :", panelText(dom).includes("repair"));
console.log("Airstrike proposé (attendu true — accepte n'importe quel dé) :", panelText(dom).includes("airstrike"));
console.log("Nitro NON proposé avec un dé 6 (attendu true — nitro n'accepte que 1 à 3) :", !panelText(dom).includes("nitro"));
console.log("Drift NON proposé avec un dé 6 (attendu true — drift n'accepte que 3 à 5) :", !panelText(dom).includes("drift"));

section("Test 3 — Choisir le dé 1 -> seul Nitro (+ Airstrike) est compatible, jamais Drift/Repair");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const myCar2 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 3, 3);
G.allCars.push(myCar2);
G.roundState.dicePool[HUMAN] = [6, 4, 4, 1];
sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = true;
sel.step = "die";
win.pickDie(4);
win.pickCar(myCar2);
win.pickCommandDieChoice(1);
sel = win.eval("sel");
win.render();

console.log("Étape (attendu 'command') :", sel.step);
console.log("Nitro proposé (attendu true — 1 est dans la plage 1-3) :", panelText(dom).includes("nitro"));
console.log("Drift NON proposé (attendu true — 1 n'est pas dans la plage 3-5) :", !panelText(dom).includes("drift"));
console.log("Repair NON proposé (attendu true — pas un 6) :", !panelText(dom).includes("repair"));

section("Test 4 — Choisir 'Aucune Command' directement après la voiture -> saute droit à commit, sans jamais passer par un choix de type");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const myCar3 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 3, 3);
G.allCars.push(myCar3);
G.roundState.dicePool[HUMAN] = [6, 4, 4, 1];
sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = true;
sel.step = "die";
win.pickDie(4);
win.pickCar(myCar3);
win.render();
clickButtonContaining(dom, "Aucune Command");
sel = win.eval("sel");

console.log("Étape (attendu 'commit') :", sel.step);
console.log("sel.command bien à null (attendu true) :", sel.command === null);

section("Test 5 — Bout en bout via de vrais clics : dé -> voiture -> dé de Command (6) -> clic sur 'repair' -> cible");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const myCar5 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 3, 3);
myCar5.damageTokens = ["dent"];
G.allCars.push(myCar5);
G.roundState.dicePool[HUMAN] = [6, 4, 4, 1];
sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = true;
sel.step = "die";
win.render();
clickButtonContaining(dom, "4");
win.render();
clickButtonContaining(dom, "medium");
win.render();
clickButtonContaining(dom, "6");
win.render();
clickButtonContaining(dom, "repair");
sel = win.eval("sel");
win.render();
console.log("Étape après clic sur 'repair' (attendu 'repair-target') :", sel.step);
clickButtonContaining(dom, "medium");
sel = win.eval("sel");
console.log("Commande finale bien enregistrée (attendu true) :", sel.command && sel.command.type === "repair" && sel.command.dieValue === 6 && sel.command.target === myCar5);
console.log("Étape finale (attendu 'commit') :", sel.step);

console.log("\n=== Fin des tests dédiés (réordonnancement du choix de Command) ===");
