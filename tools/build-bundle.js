const fs = require("fs");
const path = require("path");

// Ce script est prévu pour vivre dans tools/ — la racine du dépôt
// (où se trouvent engine.js, ai-decision.js, human-decision.js,
// turn-executor.js) est donc un niveau au-dessus.
const repoRoot = path.join(__dirname, "..");

function stripRequiresAndDestructuring(src, patterns) {
  let out = src;
  for (const p of patterns) {
    if (!out.includes(p)) {
      throw new Error("Motif introuvable, bundle potentiellement désynchronisé du dépôt :\n" + p);
    }
    out = out.replace(p, "");
  }
  return out;
}

// --- engine.js : aucun require, utilisé tel quel ---
const engineSrc = fs.readFileSync(path.join(repoRoot, "engine.js"), "utf8");

// --- ai-decision.js : retirer son require(engine) + destructuring ---
let aiSrc = fs.readFileSync(path.join(repoRoot, "ai-decision.js"), "utf8");
aiSrc = stripRequiresAndDestructuring(aiSrc, [
  'const engine = require("./engine.js");\n'
]);
// Le bloc de destructuring `const { ... } = engine;` doit rester
// SYNTAXIQUEMENT valide mais `engine` n'existe plus comme objet une
// fois concaténé : on le remplace par un objet vide (les noms
// utilisés dedans existent déjà directement dans le scope global
// après concaténation d'engine.js, donc cette ligne devient
// inoffensive, juste redondante).
aiSrc = aiSrc.replace(/const \{([\s\S]*?)\} = engine;/, "// (destructuring engine.js retiré pour le bundle navigateur — noms déjà globaux)");
// Collision de nom : ai-decision.js redéfinit SIZE_RANK (valeur
// IDENTIQUE à celle d'engine.js, vérifié) — la déclaration
// d'ai-decision.js est retirée, celle d'engine.js suffit une fois
// concaténées dans le même scope global.
aiSrc = aiSrc.replace(
  "const SIZE_RANK = {\n  [CAR_SIZE.SMALL]: 1,\n  [CAR_SIZE.MEDIUM]: 2,\n  [CAR_SIZE.LARGE]: 3\n};",
  "// (SIZE_RANK retiré du bundle navigateur — déjà défini par engine.js, valeur identique)"
);

// --- human-decision.js ---
let humanSrc = fs.readFileSync(path.join(repoRoot, "human-decision.js"), "utf8");
humanSrc = stripRequiresAndDestructuring(humanSrc, [
  'const engine = require("./engine.js");\nconst ai = require("./ai-decision.js");\n'
]);
humanSrc = humanSrc.replace(/const \{ CAR_STATUS, TERRAIN, getSpace, getCarAt \} = engine;/, "// (destructuring engine.js retiré pour le bundle navigateur — noms déjà globaux)");
humanSrc = humanSrc.replace(/const \{ computeReachableDestinations, computeReachableEntryDestinations \} = ai;/, "// (destructuring ai-decision.js retiré pour le bundle navigateur — noms déjà globaux)");

// --- turn-executor.js ---
let executorSrc = fs.readFileSync(path.join(repoRoot, "turn-executor.js"), "utf8");
executorSrc = stripRequiresAndDestructuring(executorSrc, [
  'const engine = require("./engine.js");\nconst ai = require("./ai-decision.js");\n'
]);
executorSrc = executorSrc.replace(/const \{([\s\S]*?)\} = engine;/, "// (destructuring engine.js retiré pour le bundle navigateur — noms déjà globaux)");
// turn-executor.js appelle aussi directement ai.xxx(...) / engine.xxx(...)
// à quelques endroits précis (pas seulement via le destructuring
// ci-dessus) — remplacés par leur nom nu, déjà global après
// concaténation.
executorSrc = executorSrc.replace(/\bai\.computeShotTargetForDecision\b/g, "computeShotTargetForDecision");
executorSrc = executorSrc.replace(/\bai\.chooseShootTarget\b/g, "chooseShootTarget");
executorSrc = executorSrc.replace(/\bengine\.buildBoardFromProgressionState\b/g, "buildBoardFromProgressionState");
// Contrairement à engine.js/ai-decision.js/human-decision.js,
// turn-executor.js exporte SANS garde `typeof module !== "undefined"`
// (il n'a jamais eu besoin de tourner ailleurs qu'en Node jusqu'ici) —
// on retire ce bloc pour le bundle navigateur ; les fonctions restent
// accessibles directement par leur nom dans le scope global concaténé.
executorSrc = executorSrc.replace(/\nmodule\.exports = \{ checkDecisionLegality, executeDecision \};\n/, "\n// (module.exports retiré pour le bundle navigateur — fonctions déjà globales)\n");

// --- tiles/data/*.js : déjà du JS vanilla (const TILE_VENDETTA_XXX = {...}) ---
const tilesDir = path.join(repoRoot, "tiles", "data");
const tileFiles = fs.readdirSync(tilesDir).sort();
const tilesSrc = tileFiles.map((f) => fs.readFileSync(path.join(tilesDir, f), "utf8")).join("\n");
const tileVarNames = tileFiles.map((f) => "TILE_VENDETTA_" + path.basename(f, ".js").replace("vendetta-", "").toUpperCase());

const loaderSrc = `
// Remplace tools/run-shadow-legality.js::loadRealTiles() (qui lit le
// système de fichiers + un sandbox vm — inutile ici, les tuiles sont
// déjà concaténées ci-dessus en variables globales).
function loadRealTiles() {
  return [${tileVarNames.join(", ")}];
}
`;

const bundle = [
  '"use strict";',
  "// ==================== engine.js ====================",
  engineSrc.replace('"use strict";', ""),
  "// ==================== ai-decision.js ====================",
  aiSrc.replace('"use strict";', ""),
  "// ==================== human-decision.js ====================",
  humanSrc.replace('"use strict";', ""),
  "// ==================== turn-executor.js ====================",
  executorSrc.replace('"use strict";', ""),
  "// ==================== tiles/data/*.js ====================",
  tilesSrc,
  loaderSrc
].join("\n\n");

const outPath = path.join(__dirname, "game-bundle.js");
fs.writeFileSync(outPath, bundle);
console.log("Bundle écrit :", outPath, "(" + bundle.length + " octets)");

// Assemble aussi directement prototype.html (template.html + bundle +
// ui-script.js, les 3 dans le même dossier tools/) pour ne pas avoir
// à le faire à la main à chaque régénération.
const templatePath = path.join(__dirname, "template.html");
const uiScriptPath = path.join(__dirname, "ui-script.js");
if (fs.existsSync(templatePath) && fs.existsSync(uiScriptPath)) {
  const template = fs.readFileSync(templatePath, "utf8");
  const uiScript = fs.readFileSync(uiScriptPath, "utf8");
  const finalHtml = template.replace("__ENGINE_BUNDLE__", bundle).replace("__UI_SCRIPT__", uiScript);
  const finalPath = path.join(__dirname, "prototype.html");
  fs.writeFileSync(finalPath, finalHtml);
  console.log("Prototype assemblé :", finalPath, "(" + finalHtml.length + " octets)");
}
