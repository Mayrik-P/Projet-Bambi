/**
 * Test du moteur de mise en page — à lancer avec :
 *   node test-layout-engine.js
 *
 * DIFFÉRENCE ASSUMÉE avec les autres tests du dépôt : ceux-ci
 * affichent des `console.log` qu'on relit à l'œil. Ici le volume rend
 * ça impossible — le balayage passe ~12 000 combinaisons de taille
 * d'écran — donc chaque vérification est comptée et le script sort en
 * code d'erreur si une seule échoue. C'est précisément ce que la
 * mise en page ne permettait pas avant d'être une fonction pure :
 * on ne pouvait la juger qu'en regardant un téléphone.
 *
 * CE QUI EST VÉRIFIÉ :
 *  1. le bon profil est choisi selon la forme de l'écran ;
 *  2. sur les appareils réels, chaque module reçoit au moins son
 *     minimum ;
 *  3. sur TOUTES les tailles balayées : aucun module en flux ne
 *     déborde de l'écran, aucun ne chevauche un autre ;
 *  4. le plateau montre toujours ses 6 rangées et au moins une tuile ;
 *  5. l'échelle de dégradation sacrifie bien dans l'ordre prévu ;
 *  6. la frontière connue (360 px de large) est verrouillée : en
 *     dessous, le contrat est déclaré intenable plutôt que faussement
 *     satisfait.
 */

const { SPEC, boardMinH, computeLayout } = require("./layout-engine.js");

let passed = 0;
const failures = [];
function section(title) { console.log("\n=== " + title + " ==="); }
function check(label, condition, detail) {
  if (condition) { passed++; return true; }
  failures.push(label + (detail ? " — " + detail : ""));
  console.log("  ÉCHEC : " + label + (detail ? " — " + detail : ""));
  return false;
}

// Modules réellement posés dans la grille (hors surimpression).
const flowZones = (L) => Object.values(L.zones).filter((z) => z && z.id && !z.overlay);
const allZones  = (L) => Object.values(L.zones).filter((z) => z && z.id);

function overlaps(a, b) {
  return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 &&
         a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
}

// -----------------------------------------------------------------
// TEST 1 : choix du profil selon la forme de l'écran
// -----------------------------------------------------------------
section("Choix du profil");
[
  ["Pixel portrait",     412,  915, "portrait"],
  ["Pixel paysage",      915,  412, "landscape"],
  ["iPhone SE portrait", 375,  667, "portrait"],
  ["Tablette portrait",  820, 1180, "portrait"],
  ["Ordinateur",        1512,  850, "wide"],
  ["Grand écran",       1920, 1080, "wide"],
  // Une fenêtre large mais écrasée n'est PAS un écran large : elle n'a
  // pas la hauteur d'une colonne latérale, elle est traitée en paysage.
  ["Fenêtre large aplatie", 1200, 400, "landscape"]
].forEach(([nom, w, h, attendu]) => {
  const L = computeLayout(w, h, 4, "auto");
  check(nom + " -> " + attendu, L.profile === attendu, "obtenu : " + L.profile);
});

// -----------------------------------------------------------------
// TEST 2 : contrat respecté sur les appareils réels
// -----------------------------------------------------------------
section("Contrat d'affichage sur appareils réels");
const APPAREILS = [
  ["Pixel portrait", 412, 915], ["Pixel paysage", 915, 412],
  ["Galaxy portrait", 360, 800], ["Galaxy paysage", 800, 360],
  ["iPhone SE portrait", 375, 667], ["iPhone SE paysage", 667, 375],
  ["Tablette portrait", 820, 1180], ["Tablette paysage", 1180, 820],
  ["iPad paysage", 1024, 768], ["iPad portrait", 768, 1024],
  ["Ordinateur", 1512, 850], ["Grand écran", 1920, 1080]
];
APPAREILS.forEach(([nom, w, h]) => {
  for (const joueurs of [2, 3, 4]) {
    const L = computeLayout(w, h, joueurs, "auto");
    const sous = allZones(L).filter((z) => z.w < z.minW - 0.5 || z.h < z.minH - 0.5);
    check(nom + " / " + joueurs + " joueurs : tous les modules au-dessus de leur minimum",
      sous.length === 0, sous.map((z) => z.id).join(", "));
  }
});

// -----------------------------------------------------------------
// TEST 3 : invariants de structure sur un balayage complet
// -----------------------------------------------------------------
section("Balayage complet des tailles d'écran");
let combinaisons = 0, debordements = 0, chevauchements = 0, sousMinimum = 0;
const sousMinimumLargeurs = new Set();
for (let w = 320; w <= 1920; w += 20) {
  for (let h = 320; h <= 1280; h += 20) {
    for (const joueurs of [2, 3, 4]) {
      combinaisons++;
      const L = computeLayout(w, h, joueurs, "auto");
      const flux = flowZones(L);
      // Aucun module en flux ne sort de l'écran.
      if (flux.some((z) => z.x < -0.5 || z.y < -0.5 || z.x + z.w > w + 1 || z.y + z.h > h + 1)) debordements++;
      // Aucun module en flux n'en recouvre un autre.
      for (let i = 0; i < flux.length; i++) {
        for (let j = i + 1; j < flux.length; j++) {
          if (overlaps(flux[i], flux[j])) { chevauchements++; i = flux.length; break; }
        }
      }
      if (allZones(L).some((z) => z.w < z.minW - 0.5 || z.h < z.minH - 0.5)) {
        sousMinimum++; sousMinimumLargeurs.add(w);
      }
    }
  }
}
console.log("  Combinaisons évaluées :", combinaisons);
check("aucun module en flux ne déborde de l'écran", debordements === 0, debordements + " cas");
check("aucun chevauchement entre modules en flux", chevauchements === 0, chevauchements + " cas");

// -----------------------------------------------------------------
// TEST 4 : le plateau garde toujours ses 6 rangées et une tuile
// -----------------------------------------------------------------
section("Règles dures du plateau");
let tuileTropPetite = 0, rangeesPerdues = 0;
for (let w = 360; w <= 1920; w += 20) {
  for (let h = 360; h <= 1280; h += 20) {
    const L = computeLayout(w, h, 4, "auto");
    // Une tuile entière doit rester visible en largeur.
    if (L.tiles < 0.995) tuileTropPetite++;
    // La hauteur du plateau ne descend jamais sous son minimum, lui-même
    // plafonné par la règle de la tuile sur les écrans très étroits.
    const b = L.zones.board;
    if (b.h < Math.min(boardMinH, SPEC.board.vbH * (b.w / SPEC.board.tileW)) - 0.5) rangeesPerdues++;
  }
}
check("au moins une tuile entière visible partout", tuileTropPetite === 0, tuileTropPetite + " cas");
check("les 6 rangées tiennent toujours dans la fenêtre du plateau", rangeesPerdues === 0, rangeesPerdues + " cas");

// La case ne descend sous 44 px que sur les écrans trop étroits pour
// qu'une tuile entière y tienne à cette taille — nulle part ailleurs.
let casesTropPetites = [];
for (let w = 363; w <= 1920; w += 20) {
  for (let h = 400; h <= 1280; h += 20) {
    const L = computeLayout(w, h, 4, "auto");
    if (L.cell < SPEC.board.cellMin - 0.5) casesTropPetites.push(w + "x" + h + " -> " + L.cell.toFixed(1));
  }
}
check("case >= 44 px dès que la largeur le permet (>= 363 px)",
  casesTropPetites.length === 0, casesTropPetites.slice(0, 3).join(" · "));

// -----------------------------------------------------------------
// TEST 5 : ordre de l'échelle de dégradation
// -----------------------------------------------------------------
section("Échelle de dégradation");
// Sur un Pixel en portrait il y a la place pour tout : aucun module ne
// doit être renvoyé en surimpression.
const pixel = computeLayout(412, 915, 4, "auto");
check("Pixel portrait : aucune surimpression nécessaire",
  allZones(pixel).every((z) => !z.overlay),
  allZones(pixel).filter((z) => z.overlay).map((z) => z.id).join(", "));
// Idem en paysage, grâce à la colonne latérale.
const pixelP = computeLayout(915, 412, 4, "auto");
check("Pixel paysage : aucune surimpression nécessaire",
  allZones(pixelP).every((z) => !z.overlay),
  allZones(pixelP).filter((z) => z.overlay).map((z) => z.id).join(", "));
// Sur un écran court, le dicetrack part AVANT l'illustration.
const court = computeLayout(375, 667, 4, "auto");
check("écran court : le dicetrack cède avant l'illustration",
  court.zones.dice.overlay === true, "dicetrack en flux alors que la place manque");
// L'info contextuelle et le plateau ne sont jamais mis en surimpression,
// quelle que soit la taille : ce sont les deux modules porteurs du jeu.
let infoOuPlateauSacrifies = 0;
for (let w = 360; w <= 1920; w += 40) {
  for (let h = 360; h <= 1280; h += 40) {
    const L = computeLayout(w, h, 4, "auto");
    if (L.zones.info.overlay || L.zones.board.overlay) infoOuPlateauSacrifies++;
  }
}
check("le plateau et l'info ne passent jamais en surimpression", infoOuPlateauSacrifies === 0,
  infoOuPlateauSacrifies + " cas");
// Au moins deux dashboards restent visibles tant que la hauteur le permet.
const deuxDash = computeLayout(412, 915, 4, "auto");
check("Pixel portrait : au moins 2 dashboards visibles", deuxDash.visible >= 2,
  "visibles : " + deuxDash.visible);

// -----------------------------------------------------------------
// TEST 6 : la frontière basse est verrouillée, pas maquillée
// -----------------------------------------------------------------
section("Frontière des très petits écrans");
// Sous 360 px de large, le contrat est intenable (le bandeau d'info et
// les dashboards n'ont plus la place). Le moteur doit le SIGNALER en
// laissant des modules sous leur minimum, jamais faire semblant.
const minuscule = computeLayout(320, 568, 4, "auto");
check("320 px de large : le moteur déclare le contrat intenable",
  allZones(minuscule).some((z) => z.w < z.minW - 0.5 || z.h < z.minH - 0.5));
// Et au-dessus de 360 px, plus aucun écran ne doit échouer.
const echecsAuDessus = [...sousMinimumLargeurs].filter((w) => w >= 360);
check("aucun échec de contrat au-dessus de 360 px de large",
  echecsAuDessus.length === 0, "largeurs en échec : " + echecsAuDessus.join(", "));

// -----------------------------------------------------------------
section("Bilan");
console.log("  Vérifications réussies :", passed);
console.log("  Échecs :", failures.length);
if (failures.length) {
  failures.forEach((f) => console.log("   - " + f));
  process.exitCode = 1;
} else {
  console.log("  Moteur de mise en page conforme.");
}
