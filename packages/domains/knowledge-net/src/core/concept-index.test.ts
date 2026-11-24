import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  annotateText,
  buildConceptIndex,
  lookupConcept,
  normalizeConceptTerm,
  type AnalysisSource
} from './concept-index.js';

const SOURCES: readonly AnalysisSource[] = [
  {
    paperId: 'paper-1',
    versionId: 'v-1',
    contentDigest: 'digest-1',
    analysis: {
      concepts: [
        {
          term: 'Representational Similarity Analysis',
          definition: 'A method that compares representational spaces by correlating dissimilarity matrices.',
          provenance: { quote: 'we compare representational geometries' },
          contrastWith: 'decoding analysis',
          analogy: 'Comparing two libraries by the pairwise distances between books.',
          subConcept: {
            term: 'dissimilarity matrix',
            definition: 'A square matrix of pairwise distances between activity patterns.'
          }
        }
      ],
      conceptTargets: [
        { term: 'multivariate pattern analysis' },
        { term: 'Representational Similarity Analysis' }
      ]
    }
  },
  {
    paperId: 'paper-2',
    versionId: 'v-2',
    contentDigest: 'digest-2',
    analysis: {
      concepts: [
        {
          term: 'Hierarchical processing',
          definition: 'Information flows through stages of increasing abstraction.'
        }
      ],
      conceptTargets: [{ term: 'feedforward sweep' }]
    }
  }
];

const INDEX = buildConceptIndex(SOURCES);

describe('buildConceptIndex', () => {
  it('extracts concepts with provenance and one-level sub-concepts', () => {
    assert.equal(INDEX.concepts.length, 2);
    assert.deepEqual(
      {
        term: INDEX.concepts[0]!.term,
        normalizedTerm: INDEX.concepts[0]!.normalizedTerm,
        paperId: INDEX.concepts[0]!.paperId,
        versionId: INDEX.concepts[0]!.versionId,
        contentDigest: INDEX.concepts[0]!.contentDigest,
        provenanceQuote: INDEX.concepts[0]!.provenanceQuote,
        subConcept: INDEX.concepts[0]!.subConcept?.term
      },
      {
        term: 'Representational Similarity Analysis',
        normalizedTerm: 'representational similarity analysis',
        paperId: 'paper-1',
        versionId: 'v-1',
        contentDigest: 'digest-1',
        provenanceQuote: 'we compare representational geometries',
        subConcept: 'dissimilarity matrix'
      }
    );
  });

  it('keeps targeted-but-unexcavated terms as gap targets and drops duplicates', () => {
    assert.equal(INDEX.targets.length, 2);
    assert.deepEqual(INDEX.targets.map((t) => t.term).sort(), ['feedforward sweep', 'multivariate pattern analysis']);
    assert.ok(INDEX.targets.every((t) => t.unexcavated));
  });
});

describe('lookupConcept', () => {
  it('hits on case-insensitive normalized exact match', () => {
    const result = lookupConcept(INDEX, '  representational   similarity analysis ');
    assert.equal(result.status, 'hit');
    assert.equal(result.concept?.term, 'Representational Similarity Analysis');
    assert.match(result.concept!.definition, /dissimilarity matrices/);
  });

  it('finds a bilingual term under both of its names', () => {
    const bilingual = buildConceptIndex([{
      paperId: 'paper-cn',
      versionId: 'v-cn',
      contentDigest: 'digest-cn',
      analysis: {
        concepts: [{ term: '偏心度偏置（eccentricity bias）', definition: '高阶视觉区按视觉场偏心度组织的布局原则。' }]
      }
    }]);
    for (const query of ['eccentricity bias', '偏心度偏置', '偏心度偏置（eccentricity bias）']) {
      const result = lookupConcept(bilingual, query);
      assert.equal(result.status, 'hit', query);
      assert.equal(result.concept?.term, '偏心度偏置（eccentricity bias）');
    }
    const spans = annotateText(bilingual, 'We saw an eccentricity bias in 偏心度偏置 maps.');
    assert.equal(spans.length, 2);
  });

  it('hits on a mined Latin alias from the definition parenthetical', () => {
    const bilingual = buildConceptIndex([{
      paperId: 'paper-cn',
      versionId: 'v-cn',
      contentDigest: 'digest-cn',
      analysis: {
        concepts: [{
          term: '偏心度偏置',
          definition: '偏心度偏置（eccentricity bias）：高阶视觉区按视觉场偏心度组织的布局原则。'
        }]
      }
    }]);
    const result = lookupConcept(bilingual, 'Eccentricity Bias');
    assert.equal(result.status, 'hit');
    assert.equal(result.concept?.term, '偏心度偏置');
  });

  it('resolves sub-concept terms to the parent entry with matchedSubConcept set', () => {
    const result = lookupConcept(INDEX, 'Dissimilarity Matrix');
    assert.equal(result.status, 'hit');
    assert.equal(result.matchedSubConcept?.term, 'dissimilarity matrix');
    assert.equal(result.concept?.term, 'Representational Similarity Analysis');
  });

  it('reports unexcavated targets as gaps with their sources', () => {
    const result = lookupConcept(INDEX, 'multivariate pattern analysis');
    assert.equal(result.status, 'gap_unexcavated');
    assert.deepEqual(result.target && { term: result.target.term, paperId: result.target.paperId }, {
      term: 'multivariate pattern analysis',
      paperId: 'paper-1'
    });
  });

  it('reports unknown terms with prefix candidates', () => {
    const result = lookupConcept(INDEX, 'representational');
    assert.equal(result.status, 'gap_unknown');
    assert.deepEqual(result.candidates[0], { term: 'Representational Similarity Analysis', paperId: 'paper-1' });
  });

  it('matches candidates across hyphen and space spellings without upgrading them to hits', () => {
    const index = buildConceptIndex([{
      paperId: 'paper-hedger',
      versionId: 'v-hedger',
      contentDigest: 'digest-hedger',
      analysis: {
        concepts: [{
          term: 'connective-field modelling (dual-source V1 + S1)',
          definition: 'A field estimated jointly from visual and somatosensory sources.'
        }]
      }
    }]);

    const spaced = lookupConcept(index, 'connective field');
    assert.equal(spaced.status, 'gap_unknown');
    assert.deepEqual(spaced.candidates, [{
      term: 'connective-field modelling (dual-source V1 + S1)',
      paperId: 'paper-hedger'
    }]);

    // The exact hyphenated spelling still hits.
    assert.equal(lookupConcept(index, 'connective-field modelling (dual-source V1 + S1)').status, 'hit');
  });

  it('offers a candidate when the query is the tail of a concept alias', () => {
    const index = buildConceptIndex([{
      paperId: 'paper-hedger',
      versionId: 'v-hedger',
      contentDigest: 'digest-hedger',
      analysis: {
        concepts: [{
          term: '视觉诱发躯体拓扑图（visually evoked somatotopic map）',
          definition: '背外侧视觉皮层中按身体部位排列的拓扑图。'
        }]
      }
    }]);

    const result = lookupConcept(index, 'somatotopic map');
    assert.equal(result.status, 'gap_unknown');
    assert.deepEqual(result.candidates, [{
      term: '视觉诱发躯体拓扑图（visually evoked somatotopic map）',
      paperId: 'paper-hedger'
    }]);

    assert.equal(lookupConcept(index, 'visually evoked somatotopic map').status, 'hit');
  });

  it('ignores substring candidates for queries shorter than three characters', () => {
    const result = lookupConcept(INDEX, 'a');
    assert.equal(result.status, 'gap_unknown');
    assert.deepEqual(result.candidates, []);
  });

  it('offers a candidate when the query words appear in a longer stored term', () => {
    const index = buildConceptIndex([{
      paperId: 'paper-hedger',
      versionId: 'v-hedger',
      contentDigest: 'digest-hedger',
      analysis: {
        concepts: [{
          term: 'toe–tongue ordinal axis',
          definition: 'A ranked body-part ordering measured in visual cortex.'
        }]
      }
    }]);

    // "toe-tongue axis" is neither a prefix nor a substring of the stored term;
    // only the word set overlaps.
    const result = lookupConcept(index, 'toe-tongue axis');
    assert.equal(result.status, 'gap_unknown');
    assert.deepEqual(result.candidates, [{ term: 'toe–tongue ordinal axis', paperId: 'paper-hedger' }]);
  });

  it('keeps closer near misses ahead of token-subset matches', () => {
    const index = buildConceptIndex([
      {
        paperId: 'paper-subset',
        versionId: 'v-subset',
        contentDigest: 'digest-subset',
        analysis: {
          concepts: [{
            term: 'ordinal axis of the toe tongue map',
            definition: 'Token-subset only.'
          }]
        }
      },
      {
        paperId: 'paper-prefix',
        versionId: 'v-prefix',
        contentDigest: 'digest-prefix',
        analysis: {
          concepts: [{
            term: 'toe tongue axis',
            definition: 'A literal prefix of the query.'
          }]
        }
      }
    ]);

    const result = lookupConcept(index, 'toe tongue axis value');
    assert.equal(result.status, 'gap_unknown');
    // The prefix entry is later in the index but must still rank first.
    assert.deepEqual(result.candidates[0], { term: 'toe tongue axis', paperId: 'paper-prefix' });
  });

  it('refuses token-subset candidates when the stored term swamps the query', () => {
    const index = buildConceptIndex([{
      paperId: 'paper-long',
      versionId: 'v-long',
      contentDigest: 'digest-long',
      analysis: {
        concepts: [{
          term: 'a long survey of body maps that mentions the toe and the axis once',
          definition: 'Far too many extra words to be a useful near miss.'
        }]
      }
    }]);

    // Both query words are present and in order, but the stored term is not a
    // near miss for "toe axis"; suggesting it would imply precision the index
    // does not have.
    assert.deepEqual(lookupConcept(index, 'toe axis').candidates, []);
  });

  it('requires the query words in stored order, not any order', () => {
    const index = buildConceptIndex([{
      paperId: 'paper-hedger',
      versionId: 'v-hedger',
      contentDigest: 'digest-hedger',
      analysis: {
        concepts: [{
          term: 'toe–tongue ordinal axis',
          definition: 'A ranked body-part ordering measured in visual cortex.'
        }]
      }
    }]);

    assert.deepEqual(lookupConcept(index, 'toe-tongue axis').candidates, [
      { term: 'toe–tongue ordinal axis', paperId: 'paper-hedger' }
    ]);
    assert.deepEqual(lookupConcept(index, 'axis toe').candidates, []);
  });
});

describe('annotateText', () => {
  it('marks known concepts and unexcavated targets with correct offsets', () => {
    const text = 'We used representational similarity analysis, then multivariate pattern analysis.';
    const t1 = 'representational similarity analysis';
    const t2 = 'multivariate pattern analysis';
    const spans = annotateText(INDEX, text);
    assert.deepEqual(spans, [
      { start: text.indexOf(t1), end: text.indexOf(t1) + t1.length, term: 'Representational Similarity Analysis', status: 'known' },
      { start: text.indexOf(t2), end: text.indexOf(t2) + t2.length, term: 'multivariate pattern analysis', status: 'unexcavated' }
    ]);
  });

  it('requires token boundaries so substrings inside words do not match', () => {
    assert.deepEqual(annotateText(INDEX, 'representational similarity analysisextra'), []);
  });

  it('matches case-insensitively and prefers the longest term', () => {
    const text = 'Hierarchical Processing matters';
    assert.deepEqual(annotateText(INDEX, text), [
      { start: 0, end: 'Hierarchical Processing'.length, term: 'Hierarchical processing', status: 'known' }
    ]);
  });

  it('matches CJK terms mid-sentence where surrounding characters are letters', () => {
    const chinese = buildConceptIndex([{
      paperId: 'paper-cn',
      versionId: 'v-cn2',
      contentDigest: 'digest-cn2',
      analysis: {
        concepts: [{ term: '表征相似性分析', definition: '跨模态对齐方法（representational similarity analysis）。' }],
        conceptTargets: [{ term: '范畴特化' }]
      }
    }]);
    const text = '本文用表征相似性分析融合两种模态，并讨论范畴特化问题。';
    const spans = annotateText(chinese, text);
    assert.deepEqual(spans.map((s) => [s.term, s.status]), [
      ['表征相似性分析', 'known'],
      ['范畴特化', 'unexcavated']
    ]);
  });
});

describe('normalizeConceptTerm', () => {
  it('trims, collapses whitespace and lowercases', () => {
    assert.equal(normalizeConceptTerm('  Feedforward   Sweep '), 'feedforward sweep');
  });
});


describe('multiple sealed explanations', () => {
  it('preserves conditional disagreement independently of input order, including sub-concepts', () => {
    const sources: AnalysisSource[] = [
      { paperId: 'a', versionId: 'va', contentDigest: 'da', analysis: { concepts: [{ term: 'Transfer', definition: 'Improves under matched noise.', subConcept: { term: 'Robustness', definition: 'Only under noise A.' } }] } },
      { paperId: 'b', versionId: 'vb', contentDigest: 'db', analysis: { concepts: [{ term: 'Transfer', definition: 'Degrades under shifted noise.', subConcept: { term: 'Robustness', definition: 'Fails under noise B.' } }] } }
    ];
    for (const term of ['Transfer', 'Robustness']) {
      const result = lookupConcept(buildConceptIndex(sources), term);
      assert.equal(result.status, 'multiple_sources');
      assert.equal(result.concept, undefined);
      assert.equal(result.matches.length, 2);
      assert.deepEqual(result, lookupConcept(buildConceptIndex([...sources].reverse()), term));
      assert.deepEqual(result.matches.map((m) => m.concept.versionId), ['va', 'vb']);
    }
  });
});


it('retains another paper reading target even when one explanation is known', () => {
  const result = lookupConcept(buildConceptIndex([
    { paperId: 'known', versionId: 'vk', contentDigest: 'dk', analysis: { concepts: [{ term: 'Transfer', definition: 'Conditional explanation.' }] } },
    { paperId: 'unexcavated', versionId: 'vu', contentDigest: 'du', analysis: { conceptTargets: [{ term: 'Transfer' }] } }
  ]), 'Transfer');
  assert.equal(result.status, 'hit');
  assert.equal(result.targets[0]?.paperId, 'unexcavated');
});
