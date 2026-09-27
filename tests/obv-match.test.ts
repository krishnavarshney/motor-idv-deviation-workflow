import assert from "node:assert/strict";
import { matchObvOption } from "../src/worker/obv-lookup";
import { parseYom } from "../src/worker/corehub-scraper";

const models = ["Ameo", "Polo", "Taigun", "Tiguan", "Tiguan AllSpace", "Tiguan R-Line"];
assert.equal(matchObvOption(models, "TIGUAN"), "Tiguan"); // case-insensitive exact
assert.equal(matchObvOption(models, "tiguan allspace"), "Tiguan AllSpace");
assert.equal(matchObvOption(models, "Tigaun"), null); // typo must not fall back to an arbitrary model
assert.equal(matchObvOption(models, ""), null);
assert.equal(matchObvOption(["Maruti Suzuki", "Mahindra"], "Maruti"), "Maruti Suzuki");
assert.equal(matchObvOption(["ZETA 1.2", "ZETA 1.2 AT"], "Zeta"), "ZETA 1.2");
assert.equal(matchObvOption(["2021", "2023"], "2022"), null);

// Real CoreHub → OBV case (Kia Syros 2026): the loose word match once picked a Diesel trim for a Petrol car.
const syros = ["HTE (O) 1.5 Diesel MT", "HTE (O) Petrol 1.0 Turbo MT", "HTE 1.0 Petrol Turbo MT", "HTK 1.0 Turbo 6MT", "HTX 1.0 Turbo 7DCT"];
assert.equal(matchObvOption(syros, "HTE 1.0 TURBO MT", "PETROL"), "HTE 1.0 Petrol Turbo MT");
assert.equal(matchObvOption(["HTE (O) 1.5 Diesel MT"], "HTE 1.0 TURBO MT", "PETROL"), null); // fuel conflict
assert.equal(matchObvOption(["VXI AT", "ZXI AT"], "AT"), null); // tie → no guess

assert.equal(parseYom("2021"), 2021);
assert.equal(parseYom("12/2021"), 2021);
assert.equal(parseYom("Mfg: 2019 (Reg 2020)"), 2019);
assert.equal(parseYom(null), null);
assert.equal(parseYom("1197"), null); // CC, not a year
assert.equal(parseYom("3021"), null);

console.log("obv-match tests passed");
