import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMaintenanceAnswer,
  detectMaintenanceIntent,
  getAllowedMaintenanceTopics,
  maintenanceKnowledgeTopics,
} from "./streamingAssistantDemo.js";

test("recognizes loose fan wiring questions", () => {
  for (const question of ["这个顺序怎么样？", "风扇怎么接？", "先接哪个？", "FAN1 和 FAN2 如何连接？"]) {
    assert.equal(detectMaintenanceIntent(question), maintenanceKnowledgeTopics.fanWiring);
  }
});

test("recognizes loose fan speed cause questions", () => {
  for (const question of ["风扇转速异常可能是什么情况导致的？", "FAN1 转速为什么这么低？", "风扇为什么转得慢？"]) {
    assert.equal(detectMaintenanceIntent(question), maintenanceKnowledgeTopics.fanSpeedCause);
  }
});

test("opens knowledge topics from the current maintenance step", () => {
  assert.deepEqual(
    getAllowedMaintenanceTopics({ stage: "guide", currentStep: { id: "step-04-filter-fan" } }),
    [maintenanceKnowledgeTopics.fanWiring, maintenanceKnowledgeTopics.fanSpeedCause],
  );
  assert.deepEqual(
    getAllowedMaintenanceTopics({ stage: "guide", currentStep: { id: "step-03-airflow" } }),
    [],
  );
});

test("only returns a specialized answer when the current step allows its topic", () => {
  const allowed = [maintenanceKnowledgeTopics.fanWiring];
  assert.match(buildMaintenanceAnswer("这个顺序怎么样？", { allowedTopics: allowed }), /FAN1 \/ FAN2 接线顺序/);
  assert.equal(buildMaintenanceAnswer("这个顺序怎么样？", { allowedTopics: [] }), null);
});
