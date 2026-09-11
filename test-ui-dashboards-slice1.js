/**
 * Test jsdom dédié — première tranche visuelle des Dashboards
 * (S1 : sélection du dé sur le diceboard ; S2/S3 : pose sur un slot
 * ANY ou COAST d'un véhicule, annulation comprise). Sur le vrai
 * bundle navigateur (tools/prototype.html), vrais clics DOM — jamais
 * une simple relecture du JS. Voir docs/spec-dashboards.md.
 * À lancer avec : node test-ui-dashboards-slice1.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }
function dashboardClickables(dom) { return [...dom.window.document.querySelectorAll("#dashboards .clickable")]; }
function click(dom, el) { el.dispatchEvent(new dom.window.Event("click", { bubbles: true })); }

section("Test 1 — Mode ASSIGN : clic sur un dé du diceboard puis sur le slot ANY d'un véhicule");

let dom = makeDom();
let win = dom.window;
win.newGame();
const HUMAN = win.eval("HUMAN");
const OPPONENT = win.eval("OPPONENT");
const CAR_SIZE = win.eval("CAR_SIZE");
let G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const small = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const medium = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const large = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(small, medium, large);
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

let clickables = dashboardClickables(dom);
console.log("Exactement 4 dés cliquables sur le diceboard au départ (attendu true) :", clickables.length === 4);

// Premier dé cliquable du diceboard -> pickDie(pool[0]).
click(dom, clickables[0]);
let sel = win.eval("sel");
console.log("Étape passée à 'car' (attendu true) :", sel.step === "car");
console.log("dieValue bien retenu (attendu 4) :", sel.dieValue);

win.render();
clickables = dashboardClickables(dom);
console.log("Exactement 3 slots ANY cliquables (un par véhicule opérable non activé) (attendu true) :", clickables.length === 3);

// Clique le slot ANY du véhicule medium (2e élément — small/medium/large dans cet ordre).
click(dom, clickables[1]);
sel = win.eval("sel");
console.log("sel.car pointe bien vers le véhicule medium (attendu true) :", sel.car === medium);
console.log("Command disponible -> étape 'command-die' (attendu true) :", sel.step === "command-die");

win.render();
clickables = dashboardClickables(dom);
console.log("4 éléments cliquables : 3 dés restants (Command) + le dé posé (annulation) (attendu true) :", clickables.length === 4);

// Le dé posé (cancelable) est inséré APRÈS les dés du diceboard dans
// l'ordre du DOM (diceboard dessiné avant la boucle des véhicules) —
// donc le dernier élément cliquable de la liste.
const posedDie = clickables[clickables.length - 1];
click(dom, posedDie);
sel = win.eval("sel");
console.log("Annulation : retour à l'étape 'die', sel.car vidé (attendu true) :", sel.step === "die" && !sel.car);

section("Test 2 — Mode COAST : plus aucun slot ANY, seul le slot COAST est proposé");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s2 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m2 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const l2 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
[s2, m2, l2].forEach((c) => { c.movedThisRound = true; c.coastCount = 0; });
G.allCars.push(s2, m2, l2);
G.roundState.dicePool[HUMAN] = [4];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

clickables = dashboardClickables(dom);
console.log("1 seul dé sur le diceboard, cliquable (attendu true) :", clickables.length === 1);
click(dom, clickables[0]);
sel = win.eval("sel");
console.log("Étape passée à 'car' (attendu true) :", sel.step === "car");

win.render();
clickables = dashboardClickables(dom);
console.log("Exactement 3 slots COAST cliquables — jamais de slot ANY en mode coast (attendu true) :", clickables.length === 3);

click(dom, clickables[0]);
sel = win.eval("sel");
console.log("sel.car pointe vers le véhicule small (attendu true) :", sel.car === s2);
console.log("Coast -> jamais de Command -> étape directement 'commit' (attendu true) :", sel.step === "commit");

win.render();
const dashboardsHtml = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Le dé posé sur le slot COAST est bien tourné à 45° (attendu true) :", dashboardsHtml.includes("rotate(45"));

section("Test 3 — Non-régression : pendant le tour de l'IA, aucun élément du diceboard humain n'est cliquable");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
win.render();
clickables = dashboardClickables(dom);
console.log("Aucun élément cliquable côté dashboards pendant le tour de l'IA (attendu true) :", clickables.length === 0);

section("Test 4 — Marqueurs de dégât : marker-damaged / marker-inoperable remplacent bien le rond noir/chiffre");

dom = makeDom();
win = dom.window;
win.newGame();
const CAR_STATUS = win.eval("CAR_STATUS");
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const dmg1 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
dmg1.damageTokens = ["dent"];
const dmg2 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
dmg2.damageTokens = ["dent", "shrapnel"];
dmg2.status = CAR_STATUS.INOPERABLE;
G.allCars.push(dmg1, dmg2);
win.render();
const boardHtml = dom.window.document.getElementById("board").innerHTML;
console.log("marker-damaged présent pour le véhicule à 1 dégât (attendu true) :", boardHtml.includes("marker-damaged.webp"));
console.log("marker-inoperable présent pour le véhicule inopérable (attendu true) :", boardHtml.includes("marker-inoperable.webp"));
console.log("Plus aucun rond noir/chiffre de l'ancien système (attendu true) :", !boardHtml.includes('fill="#111"'));

section("Test 5 — Diceboard : positions stables (pas de glissement) quand un pool imposé directement en cours de round rétrécit");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s5 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m5 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
G.allCars.push(s5, m5);
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1]; // pool imposé directement, comme les autres test-ui-*.js
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

let slots = win.eval('diceboardSlots("Vous")');
console.log("Les 4 valeurs imposées apparaissent bien dans les 4 emplacements (attendu true) :",
  JSON.stringify([...slots].sort()) === JSON.stringify([1, 3, 3, 4]));

// Un des deux dés "3" est assigné (retiré du pool réel) -> le pool
// rétrécit à 3 éléments. Sans passer par un vrai commit (pas
// nécessaire pour ce test ciblé sur l'affichage), on simule
// exactement ce que fait le moteur : retirer UNE occurrence de "3".
const idx = G.roundState.dicePool[HUMAN].indexOf(3);
G.roundState.dicePool[HUMAN].splice(idx, 1);
win.render();
const slots2 = win.eval('diceboardSlots("Vous")');
console.log("Les 3 positions des dés restants n'ont PAS bougé (attendu true) :",
  slots.map((v, i) => (v === 3 ? true : v === slots2[i])).every(Boolean));
console.log("Exactement un emplacement est maintenant vide (attendu true) :",
  slots2.filter((v) => v === null).length === 1);

section("Test 6 — Jetons dégât : rendu sous le dashboard, priorité gauche, face générique");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const noDmg = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const oneDmg = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
oneDmg.damageTokens = ["dent"];
const twoDmg = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
twoDmg.damageTokens = ["dent", "shrapnel"];
G.allCars.push(noDmg, oneDmg, twoDmg);
win.render();

const dashboardsEl = dom.window.document.getElementById("dashboards");
const dmgCount = [...dashboardsEl.querySelectorAll("image")].filter((img) => img.getAttribute("href").includes("damage-front.webp")).length;
console.log("Exactement 3 images damage-front.webp au total (0 pour SMALL + 1 pour MEDIUM + 2 pour LARGE) (attendu true) :", dmgCount === 3);
console.log("Aucun type de dégât révélé dans le rendu (dent/shrapnel) (attendu true) :", !dashboardsEl.innerHTML.includes("damage-dent") && !dashboardsEl.innerHTML.includes("damage-shrapnel"));

section("Test 7 — Command board : Drift (die 3, pas de sous-étape) jusqu'au commit");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s7 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m7 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const l7 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(s7, m7, l7);
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

win.pickDie(4);
win.render();
win.pickCar(m7); // dé 4 posé sur medium (ANY)
win.render();
clickables = dashboardClickables(dom);
console.log("3 dés restants cliquables pour Command après pose ANY (attendu true) :", clickables.length - 1 === 3);

// Clique le dé "3" restant (pip count = 3) pour le consacrer à une Command.
const dieByPips = (n) => clickables.find((el) => el.querySelectorAll("image").length - 1 === n);
click(dom, dieByPips(3));
sel = win.eval("sel");
console.log("Étape passée à 'command' (attendu true) :", sel.step === "command");
console.log("commandDieValue = 3 (attendu true) :", sel.commandDieValue === 3);

win.render();
clickables = dashboardClickables(dom);
console.log("Slots Command éligibles pour un dé 3 (nitro+drift+airstrike) + le dé ANY posé (toujours annulable) (attendu true) :", clickables.length === 4);

click(dom, clickables[1]); // ordre de rendu : nitro, drift, repair, airstrike -> drift = 2e éligible ici
sel = win.eval("sel");
console.log("Type Command choisi = 'drift' (attendu true) :", sel.commandType === "drift");
console.log("Drift n'a pas de sous-étape -> commit direct (attendu true) :", sel.step === "commit");
console.log("sel.command bien construit (attendu true) :", sel.command && sel.command.type === "drift" && sel.command.dieValue === 3);

win.render();
const dashHtml7 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Le dé de Command (tourné 45°) est visible sur le command board (attendu true) :", dashHtml7.includes("rotate(45"));

section("Test 8 — Command board : Repair (die 6) — clic sur un jeton dégât visible");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s8 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m8 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
m8.damageTokens = ["dent"]; // réparable
const l8 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(s8, m8, l8);
G.roundState.dicePool[HUMAN] = [6, 3, 1, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

win.pickDie(3);
win.render();
win.pickCar(s8); // active un AUTRE véhicule (small) que celui endommagé (medium)
win.render();
clickables = dashboardClickables(dom);
const dieByPips8 = (n) => clickables.find((el) => el.querySelectorAll && el.tagName === "g" && el.querySelectorAll("image").length - 1 === n);
click(dom, dieByPips8(6)); // consacre le dé 6 à une Command
sel = win.eval("sel");
console.log("commandDieValue = 6 (attendu true) :", sel.commandDieValue === 6);

win.render();
clickables = dashboardClickables(dom);
console.log("2 slots Command éligibles (repair + airstrike) + le dé ANY posé (attendu true) :", clickables.length === 3);
click(dom, clickables[0]); // ordre de rendu : nitro, drift, repair, airstrike -> repair = 1er éligible ici
sel = win.eval("sel");
console.log("Étape passée à 'repair-target' (attendu true) :", sel.step === "repair-target");

win.render();
const repairClickables = [...dom.window.document.querySelectorAll("#dashboards .clickable")].filter((el) => el.tagName === "image");
console.log("1 jeton dégât cliquable (celui du véhicule medium) (attendu true) :", repairClickables.length === 1);
console.log("Un halo vert (#b0d458) est visible derrière le jeton réparable (attendu true) :", dom.window.document.getElementById("dashboards").innerHTML.includes('fill="#b0d458"'));

click(dom, repairClickables[0]);
sel = win.eval("sel");
console.log("Repair cible bien le véhicule medium (attendu true) :", sel.command && sel.command.type === "repair" && sel.command.target === m8);
console.log("Étape passée à 'commit' (attendu true) :", sel.step === "commit");

console.log("\n=== Fin des tests dédiés (Dashboards, tranche 1) ===");
