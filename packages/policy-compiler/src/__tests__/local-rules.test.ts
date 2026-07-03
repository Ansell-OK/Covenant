import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { compileLocalRules } from "../providers/local-rules";
import { PolicySpec } from "@covenant/core";

// Define the source English text for each example policy based on the task spec
const examples = [
  {
    filename: "vesting-strict-after-early-withdraw.json",
    text: "Lock 40% for 15 days. If I withdraw early twice, lock 70% for 30 days.",
  },
  {
    filename: "savings-loosens-with-discipline.json",
    text: "Lock 60% for 30 days. If I honor the lock 3 times in a row, ease up by 25% and 10 days.",
  },
  {
    filename: "payroll-split-only.json",
    text: "Take 20% and send it to ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM. Keep the rest liquid.",
  },
  {
    filename: "treasury-tightens-on-outflow-spike.json",
    text: "Lock 30% for 5 days. If outflow spikes (3+ large withdrawals in a single day), lock an extra 35% for 20 days for the next two cycles.",
  },
  {
    filename: "hold-until-trust-established.json",
    text: "Keep everything liquid. Once I withdraw early, lock 40% for 10 days.",
  },
];

describe("local-rules parser matches example JSONs exactly", () => {
  for (const example of examples) {
    it(`parses ${example.filename} correctly`, () => {
      const jsonPath = join(__dirname, "../../examples", example.filename);
      const expectedJson = JSON.parse(readFileSync(jsonPath, "utf-8")) as PolicySpec;

      // Ensure the test name is what we pass in
      const result = compileLocalRules(example.text, expectedJson.name);
      
      // Compare the generated PolicySpec with the checked-in JSON
      expect(result.policy.baseline).toEqual(expectedJson.baseline);
      
      // For adjustments, we just want to match the fields present in the expected JSON
      // The expected JSON might not have ALL fields if they are default, so we compare subsets.
      expect(result.policy.adjustments).toEqual(expectedJson.adjustments);
    });
  }
});
