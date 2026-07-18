from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from project_dag.human_review import evaluate_project_human_review
from project_dag.reader import EvidenceSnapshot


def graph(*, claim_status: str = "supported", decision: dict | None = None) -> dict:
    return {
        "goals": [{
            "id": "goal-v1", "root_id": "goal-root", "parent_id": None,
            "title": "Root research intent", "status": "open",
        }],
        "claims": [{
            "id": "claim-1", "statement": "Key result", "status": claim_status,
            "load_bearing": 0.0, "blast_radius": 0,
        }],
        "decisions": [decision] if decision else [],
        "origins": [
            {"claim_id": "claim-1", "session_id": "runtime:session-1"},
            {"claim_id": "claim-1", "session_id": "runtime:session-2"},
        ],
        "evidence": [], "entities": [], "edges": [],
    }


def evaluate(value: dict, *, mode: str = "checkpointed", checkpoints=None,
             evidence_reviews=None, assessments=None, open_reviews=None) -> dict:
    return evaluate_project_human_review(
        project_key="path:/workspace/demo", graph=value,
        assessments=assessments or [], evidence_reviews=evidence_reviews or [],
        open_reviews=open_reviews or [],
        policy={"autonomy_mode": mode, "policy_version": 7,
                "checkpoints": checkpoints or []},
        input_identity={"evidenceVector": [{"threadId": "s1", "digest": "d1"}]},
        created_at="2026-07-13T00:00:00Z",
    )


class HumanReviewPolicyTests(unittest.TestCase):
    def test_evidence_snapshot_review_metadata_is_optional_and_forward_compatible(self):
        base = {
            "threadId": "runtime:session-1", "version": 1, "digest": "sha256:test",
            "inputWatermark": "1", "schemaVersion": "2", "extractorVersion": "2",
            "verifierVersion": "2", "artifactDigests": [],
            "createdAt": "2026-07-13T00:00:00Z", "status": "committed",
        }
        self.assertNotIn("humanReview", EvidenceSnapshot.from_dict(base).to_dict())
        enriched = EvidenceSnapshot.from_dict({**base, "humanReview": {
            "level": "required", "score": 0.9, "status": "pending", "blocking": True,
            "reasons": [{"code": "source_authenticity", "message": "Check source."}],
        }}).to_dict()
        self.assertEqual(enriched["humanReview"]["level"], "required")
        self.assertEqual(enriched["humanReview"]["status"], "pending")

    def test_cross_session_conflict_marks_claim_without_marking_goal_ancestor(self):
        result = evaluate(graph(claim_status="conflicted"))
        claim = result["graph"]["claims"][0]
        goal = result["graph"]["goals"][0]
        packet = result["reviewPacket"]

        self.assertEqual(claim["humanReview"]["level"], "required")
        self.assertTrue(claim["humanReview"]["blocking"])
        self.assertNotIn("humanReview", goal)
        self.assertIn("cross_session_conflict",
                      {reason["code"] for reason in claim["humanReview"]["reasons"]})
        self.assertEqual(packet["status"], "pending")
        self.assertEqual(packet["subjectIds"], ["claim-1"])
        self.assertEqual(packet["options"],
                         ["approve", "reject", "defer", "request_evidence"])
        self.assertTrue(packet["machineChecks"])
        self.assertIn("question", packet)
        self.assertIn("delta", packet)

    def test_autonomy_modes_have_explicit_blocking_behavior(self):
        fragile = graph(claim_status="fragile")
        autonomous = evaluate(fragile, mode="autonomous")
        checkpointed = evaluate(fragile, mode="checkpointed")
        checkpoint = evaluate(fragile, mode="checkpointed", checkpoints=["claim_fragile"])
        supervised = evaluate(fragile, mode="supervised")

        self.assertFalse(autonomous["graph"]["claims"][0]["humanReview"]["blocking"])
        self.assertFalse(checkpointed["graph"]["claims"][0]["humanReview"]["blocking"])
        self.assertTrue(checkpoint["graph"]["claims"][0]["humanReview"]["blocking"])
        self.assertEqual(checkpoint["graph"]["claims"][0]["humanReview"]["level"],
                         "required")
        self.assertTrue(supervised["graph"]["claims"][0]["humanReview"]["blocking"])

        irreversible = evaluate(graph(decision={
            "id": "decision-1", "action": "rollback", "decided_by": "agent",
            "reversibility": "irreversible", "confidence": 0.8,
        }), mode="autonomous")
        self.assertTrue(irreversible["graph"]["decisions"][0]["humanReview"]["blocking"])

    def test_evidence_review_and_assessment_metadata_share_the_contract(self):
        result = evaluate(
            graph(),
            evidence_reviews=[{
                "subjectType": "evidenceSnapshot", "subjectId": "runtime:session-1",
                "level": "required", "score": 0.91, "status": "pending",
                "blocking": True,
                "reasons": [{"code": "source_authenticity",
                             "message": "Source attestation needs review."}],
                "checker": {"actorType": "model", "actor": "evidence-verifier",
                            "method": "source-check/v1", "authority": "blocking"},
            }],
            assessments=[{
                "target_id": "claim-1", "dimension": "integrity", "level": "A0",
                "result": "failed", "actor": "project-dag:deterministic",
                "method": "integrity/v1", "confidence": 0.2,
            }],
        )
        indexed = {(item["subjectType"], item["subjectId"]): item
                   for item in result["humanReviews"]}
        evidence = indexed[("evidenceSnapshot", "runtime:session-1")]
        assessment = result["assessments"][0]["humanReview"]
        serialized = str(result)
        self.assertNotIn("Source attestation needs review.", serialized)
        self.assertNotIn("evidence-verifier", serialized)
        for review in (evidence, assessment):
            self.assertIn(review["status"], {
                "not_needed", "pending", "approved", "rejected", "deferred", "expired",
            })
            self.assertGreaterEqual(review["score"], 0.0)
            self.assertLessEqual(review["score"], 1.0)
            self.assertIn(review["checker"]["actorType"], {"rule", "model", "human"})
            self.assertIn(review["checker"]["authority"],
                          {"advisory", "automatic", "blocking", "override"})

    def test_rejected_upstream_evidence_is_requeued_for_project_disposition(self):
        result = evaluate(graph(), evidence_reviews=[{
            "subjectType": "evidenceSnapshot", "subjectId": "runtime:session-1",
            "level": "required", "score": 0.94, "status": "rejected",
            "blocking": True,
            "reasons": [{"code": "source_authenticity",
                         "message": "The source was rejected."}],
        }])
        packet = result["reviewPacket"]
        self.assertIsNotNone(packet)
        self.assertTrue(packet["blocking"])
        self.assertIn("upstream_review_rejected",
                      {reason["code"] for reason in packet["reasons"]})

    def test_completed_human_override_is_indexed_without_requeueing(self):
        result = evaluate(graph(decision={
            "id": "decision-override", "action": "override", "decided_by": "human",
            "reversibility": "fully_reversible", "confidence": 1.0,
        }))
        review = result["graph"]["decisions"][0]["humanReview"]
        self.assertEqual(review["status"], "approved")
        self.assertEqual(review["checker"]["authority"], "override")
        self.assertIsNone(result["reviewPacket"])


if __name__ == "__main__":
    unittest.main()
