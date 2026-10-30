import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  assessReliability,
  buildFulltextDocument,
  classifyHeading,
  extractFulltext,
  fetchPdfBytes,
  FulltextError,
  removePageFurniture,
  splitSections,
  type FulltextLine,
} from './fulltext.js';

// ---------------------------------------------------------------------------------------------
// Heading classification
// ---------------------------------------------------------------------------------------------

test('classifyHeading recognizes canonical headings in common styles', () => {
  const cases: Array<[string, string]> = [
    ['Introduction', 'introduction'],
    ['1. Introduction', 'introduction'],
    ['1 INTRODUCTION', 'introduction'],
    ['I. INTRODUCTION', 'introduction'],
    ['I NTRODUCTION', 'introduction'],
    ['2.  Materials and Methods', 'methods'],
    ['Methods', 'methods'],
    ['3 Results and Discussion', 'results'],
    ['4. Experiments', 'results'],
    ['Discussion', 'discussion'],
    ['5 Conclusion', 'conclusion'],
    ['Conclusions', 'conclusion'],
    ['Related Work', 'background'],
    ['References', 'references'],
    ['Acknowledgements', 'acknowledgements'],
    ['A. Appendix', 'appendix'],
    // Variants seen in real neuroscience and psychology papers.
    ['Material and methods', 'methods'],
    ['Materials & methods', 'methods'],
    ['Patients and Methods', 'methods'],
    ['A B S T R A C T', 'abstract'],
    ['DATA AVAILABILITY STATEMENT', 'acknowledgements'],
    ['ETHICS STATEMENT', 'acknowledgements'],
    ['ACKNOWLEDGMENTS AND DISCLOSURES', 'acknowledgements'],
    ['Conflict of interest', 'acknowledgements'],
  ];
  for (const [line, kind] of cases) {
    assert.equal(classifyHeading(line)?.kind, kind, `"${line}" should classify as ${kind}`);
  }
});

test('classifyHeading treats a numbered top-level title as another section but not a sentence', () => {
  assert.deepEqual(classifyHeading('3 Voyager'), { kind: 'other', heading: 'Voyager' });
  assert.equal(classifyHeading('3.1 Automatic Curriculum'), null, 'subsections do not start a section');
  assert.equal(classifyHeading('We evaluate the method on three benchmark datasets.'), null);
  assert.equal(classifyHeading('1 The accuracy was measured against the held-out set.'), null, 'ends with a period');
  assert.equal(classifyHeading(''), null);
});

test('classifyHeading splits an inline abstract from the text that follows it', () => {
  const heading = classifyHeading('Abstract. We show that the proposed estimator is consistent.');
  assert.equal(heading?.kind, 'abstract');
  assert.equal(heading?.rest, 'We show that the proposed estimator is consistent.');
  assert.equal(classifyHeading('Abstract')?.rest, undefined);
});

// ---------------------------------------------------------------------------------------------
// Section splitting and page furniture
// ---------------------------------------------------------------------------------------------

function lines(...entries: Array<[number, string]>): FulltextLine[] {
  return entries.map(([page, text]) => ({ page, text }));
}

test('splitSections keeps front matter, orders sections and tracks page ranges', () => {
  const sections = splitSections(
    lines(
      [1, 'A Study of Things'],
      [1, 'Jane Doe'],
      [1, 'Abstract'],
      [1, 'We study things.'],
      [1, '1 Introduction'],
      [1, 'Things matter.'],
      [2, 'They matter a lot.'],
      [2, '2 Methods'],
      [2, 'We measured things.'],
      [3, 'References'],
      [3, '[1] Someone. A paper.'],
    ),
  );
  assert.deepEqual(
    sections.map((s) => [s.kind, s.pageStart, s.pageEnd]),
    [
      ['front_matter', 1, 1],
      ['abstract', 1, 1],
      ['introduction', 1, 2],
      ['methods', 2, 2],
      ['references', 3, 3],
    ],
  );
  assert.equal(sections[0].text, 'A Study of Things Jane Doe');
  assert.equal(sections[2].text, 'Things matter. They matter a lot.');
});

test('splitSections repairs words hyphenated across a line break', () => {
  const [section] = splitSections(lines([1, 'Introduction'], [1, 'The sam-'], [1, 'pling procedure was adaptive.']));
  assert.equal(section.text, 'The sampling procedure was adaptive.');
});

test('removePageFurniture drops running headers and page numbers but keeps body text', () => {
  const pages: FulltextLine[] = [];
  for (let page = 1; page <= 5; page += 1) {
    pages.push({ page, text: 'Journal of Testing 2026' });
    pages.push({ page, text: `Body text unique to page ${page} describing the study in some detail.` });
    pages.push({ page, text: String(page) });
  }
  const cleaned = removePageFurniture(pages, 5);
  assert.equal(cleaned.some((l) => l.text === 'Journal of Testing 2026'), false);
  assert.equal(cleaned.some((l) => /^\d+$/.test(l.text)), false);
  // Long body lines that differ only by a digit are content, not furniture.
  assert.equal(cleaned.filter((l) => l.text.startsWith('Body text')).length, 5);
});

test('removePageFurniture drops a short running header whose page number changes', () => {
  const pages: FulltextLine[] = [];
  for (let page = 1; page <= 5; page += 1) {
    pages.push({ page, text: `Page ${page} of 5` });
    pages.push({ page, text: `Findings for cohort ${page} are described here in full sentences.` });
  }
  const cleaned = removePageFurniture(pages, 5);
  assert.equal(cleaned.some((l) => l.text.startsWith('Page ')), false);
  assert.equal(cleaned.length, 5);
});

test('classifyHeading accepts unnumbered all-caps headings but not short labels or sentences', () => {
  assert.deepEqual(classifyHeading('METHODOLOGICAL CONSIDERATIONS'), { kind: 'other', heading: 'METHODOLOGICAL CONSIDERATIONS' });
  assert.equal(classifyHeading('MRI'), null);
  assert.equal(classifyHeading('RESEARCH ARTICLE'), null, 'article-type labels are not sections');
  assert.equal(classifyHeading('ORIGINAL RESEARCH'), null);
  assert.equal(classifyHeading('Methods.'), null, 'a sentence-initial word with a period is body text');
  assert.equal(classifyHeading('EP EP EP EPSTEP EP'), null, 'figure label fragments are not headings');
  assert.equal(classifyHeading('GRPO OPID'), null, 'a short acronym pair is not a heading');
  assert.equal(classifyHeading('RESULTS OF THE ANALYSIS')?.kind, 'other', 'short function words are allowed');
  assert.equal(classifyHeading('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG AGAIN'), null, 'too many words');
});

test('classifyHeading rejects numbered lines that end like a list or contribution statement', () => {
  assert.equal(classifyHeading('6 Braver: Conceptualization, Project administration, Supervision,'), null);
  assert.equal(classifyHeading('1 Department of Engineering Science, Institute of Biomedical Engineering,'), null);
});

test('splitSections ignores affiliation lines that precede the first canonical heading', () => {
  const sections = splitSections(
    lines(
      [1, 'A Paper Title'],
      [1, '1 Department of Experimental Psychology, University of Oxford'],
      [1, '2 Institute of Biomedical Engineering'],
      [1, 'INTRODUCTION'],
      [1, 'Text of the introduction.'],
    ),
  );
  assert.deepEqual(sections.map((s) => s.kind), ['front_matter', 'introduction']);
  assert.match(sections[0].text, /Department of Experimental Psychology/);
});

test('splitSections does not turn numbered reference entries into sections', () => {
  const sections = splitSections(
    lines(
      [1, 'Abstract'],
      [1, 'Something was studied.'],
      [2, 'METHODOLOGICAL CONSIDERATIONS'],
      [2, 'How it was studied.'],
      [3, 'REFERENCES'],
      [3, '1. National Research Council (2011): Toward Precision Medicine'],
      [3, '2. Vieta E (2015): Personalised medicine applied to mental health'],
      [3, 'ACKNOWLEDGMENTS AND DISCLOSURES'],
      [3, 'Thanks.'],
    ),
  );
  assert.deepEqual(
    sections.map((s) => s.kind),
    ['abstract', 'other', 'references', 'acknowledgements'],
  );
  assert.equal(sections[2].text.includes('National Research Council'), true);
});

test('classifyHeading recognizes run-in back-matter headings and splits off their text', () => {
  assert.deepEqual(classifyHeading('Conflict of Interest: SP, DM, MC, and DP are employees of Huma Therapeutics'), {
    kind: 'acknowledgements',
    heading: 'Conflict of Interest',
    rest: 'SP, DM, MC, and DP are employees of Huma Therapeutics',
  });
  assert.equal(classifyHeading('Funding: This work was supported by a grant')?.kind, 'acknowledgements');
  // A sentence that merely contains the words is not a heading.
  assert.equal(classifyHeading('conflict of interest.'), null);
  assert.equal(classifyHeading('There was no funding: we used existing data.'), null);
});

test('classifyHeading recognizes further standard back-matter and appendix headings', () => {
  const cases: Array<[string, string]> = [
    ['CRediT authorship contribution statement', 'acknowledgements'],
    ['Data and Code Availabilty', 'acknowledgements'],
    ['Generative AI statement', 'acknowledgements'],
    ['Publisher’s note', 'acknowledgements'],
    ['Supporting information', 'appendix'],
    ['Appendix A. Supplementary data', 'appendix'],
    ['Appendix B', 'appendix'],
  ];
  for (const [line, kind] of cases) {
    assert.equal(classifyHeading(line)?.kind, kind, `"${line}" should classify as ${kind}`);
  }
});

test('a table-of-contents line such as "Appendix 41" is not an appendix heading', () => {
  assert.equal(classifyHeading('Appendix 41'), null);
  assert.equal(classifyHeading('Appendix A')?.kind, 'appendix');
  assert.equal(classifyHeading('Appendix A. Supplementary data')?.kind, 'appendix');
});

test('splitSections splits a run-in conflict-of-interest statement from the text before it', () => {
  const sections = splitSections(
    lines(
      [1, 'Introduction'],
      [1, 'Text.'],
      [2, 'Conflict of Interest: The authors declare no conflicts.'],
      [2, 'Publisher’s note: All claims are the authors’ own.'],
    ),
  );
  assert.deepEqual(sections.map((s) => s.kind), ['introduction', 'acknowledgements', 'acknowledgements']);
  assert.equal(sections[1].text, 'The authors declare no conflicts.');
});

// ---------------------------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------------------------

test('assessReliability separates ok, partial and failed documents', () => {
  const section = (kind: Parameters<typeof assessReliability>[0]['sections'][number]['kind']) => ({
    kind,
    heading: kind,
    text: 'x',
    pageStart: 1,
    pageEnd: 1,
  });

  const ok = assessReliability({
    sections: [section('introduction'), section('methods'), section('results'), section('references')],
    charCount: 100,
  });
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.missingCoreKinds, []);

  const partial = assessReliability({ sections: [section('front_matter'), section('abstract')], charCount: 100 });
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.missingCoreKinds, ['introduction', 'methods', 'results']);
  assert.ok(partial.warnings.includes('core_sections_missing'));

  const noHeadings = assessReliability({ sections: [section('front_matter'), section('other')], charCount: 100 });
  assert.equal(noHeadings.status, 'failed');
  assert.deepEqual(noHeadings.warnings, ['no_headings_found']);

  const noText = assessReliability({ sections: [], charCount: 0 });
  assert.equal(noText.status, 'failed');
  assert.deepEqual(noText.warnings, ['no_text_layer']);

  const unheaded = assessReliability({
    sections: [section('front_matter'), section('results'), section('methods')].map((s) => (s.kind === 'front_matter' ? { ...s, text: 'x'.repeat(5_000) } : s)),
    charCount: 6_000,
  });
  assert.equal(unheaded.status, 'partial');
  assert.ok(unheaded.warnings.includes('introduction_unheaded'));
  const shortFront = assessReliability({ sections: [section('front_matter'), section('results'), section('methods')], charCount: 100 });
  assert.equal(shortFront.warnings.includes('introduction_unheaded'), false, 'a short front matter is just a title block');

  const truncated = assessReliability({ sections: [section('introduction'), section('methods'), section('results')], charCount: 10, truncatedPages: true, truncatedChars: true });
  assert.deepEqual(truncated.warnings, ['truncated_pages', 'truncated_chars']);
  assert.equal(truncated.status, 'ok');
});

// ---------------------------------------------------------------------------------------------
// End to end: a real PDF through pdf.js
// ---------------------------------------------------------------------------------------------

async function buildPdf(pages: string[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const linesOnPage of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 780;
    for (const text of linesOnPage) {
      page.drawText(text, { x: 60, y, size: 11, font });
      y -= 18;
    }
  }
  return pdf.save();
}

test('extractFulltext splits a real PDF into sections with page numbers', async () => {
  const pdf = await buildPdf([
    ['A Study of Adaptive Sampling', 'Abstract', 'We describe an adaptive sampling scheme.', '1 Introduction', 'Sampling is hard.'],
    ['It is harder when signals drift.', '2 Methods', 'We bucketed heart rate by four hour blocks.'],
    ['3 Results', 'The scheme improved coverage.', 'References', '[1] A. Author. A paper.'],
  ]);
  const document = await extractFulltext(pdf);

  assert.equal(document.pageCount, 3);
  assert.deepEqual(
    document.sections.map((s) => s.kind),
    ['front_matter', 'abstract', 'introduction', 'methods', 'results', 'references'],
  );
  const introduction = document.sections.find((s) => s.kind === 'introduction')!;
  assert.match(introduction.text, /Sampling is hard\. It is harder when signals drift\./);
  assert.equal(introduction.pageStart, 1);
  assert.equal(introduction.pageEnd, 2);
  assert.equal(document.reliability.status, 'ok');
});

test('extractFulltext reports a PDF without a text layer as failed', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const document = await extractFulltext(await pdf.save());
  assert.equal(document.pageCount, 1);
  assert.equal(document.charCount, 0);
  assert.equal(document.reliability.status, 'failed');
  assert.deepEqual(document.reliability.warnings, ['no_text_layer']);
});

test('extractFulltext honours the page limit and says so', async () => {
  const pdf = await buildPdf([
    ['Introduction', 'Page one text.'],
    ['Methods', 'Page two text.'],
    ['Results', 'Page three text.'],
  ]);
  const document = await extractFulltext(pdf, { maxPages: 2 });
  assert.equal(document.pageCount, 3);
  assert.ok(document.reliability.warnings.includes('truncated_pages'));
  assert.equal(document.sections.some((s) => s.kind === 'results'), false);
});

test('extractFulltext rejects bytes that are not a PDF', async () => {
  await assert.rejects(
    () => extractFulltext(new TextEncoder().encode('this is not a pdf')),
    (error: unknown) => error instanceof FulltextError && error.code === 'extract_failed',
  );
});

test('buildFulltextDocument works from plain lines without a PDF', () => {
  const document = buildFulltextDocument({
    lines: lines([1, 'Abstract'], [1, 'Short.'], [1, '1 Introduction'], [1, 'Intro.'], [1, '2 Methods'], [1, 'Method.']),
    pageCount: 1,
    truncatedPages: false,
    truncatedChars: false,
  });
  assert.equal(document.reliability.status, 'ok');
  assert.deepEqual(document.reliability.missingCoreKinds, ['results']);
});

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

function responseOf(body: Uint8Array | string, init: ResponseInit = {}): Response {
  return new Response(body as BodyInit, { status: 200, ...init });
}

test('fetchPdfBytes downloads a PDF and returns its bytes', async () => {
  let requested = '';
  const bytes = await fetchPdfBytes('https://arxiv.org/pdf/2606.00001', {
    fetchImpl: (async (input: string | URL | Request) => {
      requested = String(input);
      return responseOf(pdfBytes);
    }) as typeof fetch,
  });
  assert.equal(requested, 'https://arxiv.org/pdf/2606.00001');
  assert.deepEqual([...bytes], [...pdfBytes]);
});

test('fetchPdfBytes rejects non-http URLs, non-PDF bodies and HTTP errors', async () => {
  const ok = (async () => responseOf(pdfBytes)) as typeof fetch;
  await assert.rejects(() => fetchPdfBytes('file:///etc/passwd', { fetchImpl: ok }), { code: 'invalid_url' });
  await assert.rejects(() => fetchPdfBytes('not a url', { fetchImpl: ok }), { code: 'invalid_url' });
  await assert.rejects(
    () => fetchPdfBytes('https://example.org/x', { fetchImpl: (async () => responseOf('<html>login</html>')) as typeof fetch }),
    { code: 'not_pdf' },
  );
  await assert.rejects(
    () => fetchPdfBytes('https://example.org/x', { fetchImpl: (async () => responseOf('nope', { status: 404 })) as typeof fetch }),
    { code: 'upstream_error' },
  );
});

test('fetchPdfBytes enforces the size limit from the header and from the streamed body', async () => {
  await assert.rejects(
    () =>
      fetchPdfBytes('https://example.org/x', {
        maxBytes: 1_000,
        fetchImpl: (async () => responseOf(pdfBytes, { headers: { 'content-length': '5000' } })) as typeof fetch,
      }),
    { code: 'too_large' },
  );
  await assert.rejects(
    () => fetchPdfBytes('https://example.org/x', { maxBytes: 10, fetchImpl: (async () => responseOf(pdfBytes)) as typeof fetch }),
    { code: 'too_large' },
  );
});

test('fetchPdfBytes times out while the body is still being read', async () => {
  const stalled = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pdfBytes.subarray(0, 4));
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  await assert.rejects(() => fetchPdfBytes('https://example.org/x', { fetchImpl: stalled, timeoutMs: 50 }), { code: 'timeout' });
});

test('fetchPdfBytes honours an external abort signal and reports it as a cancellation, not a timeout', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    () => fetchPdfBytes('https://example.org/x', { signal: alreadyAborted.signal, fetchImpl: (async () => responseOf(pdfBytes)) as typeof fetch }),
    { name: 'AbortError' },
  );

  const controller = new AbortController();
  const stalled = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(pdfBytes.subarray(0, 4));
        init?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  const pending = fetchPdfBytes('https://example.org/x', { signal: controller.signal, fetchImpl: stalled, timeoutMs: 5_000 });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(() => pending, { name: 'AbortError' });
});

test('fetchPdfBytes refuses local and private network targets', async () => {
  const ok = (async () => responseOf(pdfBytes)) as typeof fetch;
  for (const target of [
    'http://localhost/x.pdf',
    'http://127.0.0.1/x.pdf',
    'http://10.0.0.8/x.pdf',
    'http://192.168.1.10/x.pdf',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x.pdf',
    'http://[fd00::1]/x.pdf',
    'http://[fe80::1]/x.pdf',
    'http://[::ffff:127.0.0.1]/x.pdf',
    // Octal IPv4 is normalized by the WHATWG URL parser before the guard runs:
    // 0177 becomes 127, so the request is refused as the loopback it truly is.
    'http://0177.0.0.1/x.pdf',
    // Malformed numeric hosts never reach the guard; the URL parser rejects them.
    'http://999.1.1.1/x.pdf',
  ]) {
    const isInvalidUrl = target === 'http://999.1.1.1/x.pdf';
    await assert.rejects(
      () => fetchPdfBytes(target, { fetchImpl: ok }),
      { code: isInvalidUrl ? 'invalid_url' : 'forbidden_target' },
      target,
    );
  }
});

test('fetchPdfBytes follows redirects but re-checks every hop', async () => {
  const followed: string[] = [];
  const redirecting = (async (input: string | URL | Request) => {
    const url = String(input);
    followed.push(url);
    if (url === 'https://arxiv.org/pdf/2606.00001') {
      return responseOf('', { status: 302, headers: { location: 'https://cdn.example.org/paper.pdf' } });
    }
    if (url === 'https://cdn.example.org/paper.pdf') {
      return responseOf('', { status: 301, headers: { location: '/final.pdf' } });
    }
    return responseOf(pdfBytes);
  }) as typeof fetch;
  const bytes = await fetchPdfBytes('https://arxiv.org/pdf/2606.00001', { fetchImpl: redirecting });
  assert.deepEqual(followed, [
    'https://arxiv.org/pdf/2606.00001',
    'https://cdn.example.org/paper.pdf',
    'https://cdn.example.org/final.pdf',
  ]);
  assert.deepEqual([...bytes], [...pdfBytes]);

  const toPrivate = (async () =>
    responseOf('', { status: 302, headers: { location: 'http://192.168.1.1/internal.pdf' } })) as typeof fetch;
  await assert.rejects(
    () => fetchPdfBytes('https://arxiv.org/pdf/2606.00001', { fetchImpl: toPrivate }),
    { code: 'forbidden_target' },
  );

  let hop = 0;
  const endless = (async () => {
    hop += 1;
    return responseOf('', { status: 302, headers: { location: `https://example.org/hop-${hop}` } });
  }) as typeof fetch;
  await assert.rejects(() => fetchPdfBytes('https://example.org/start', { fetchImpl: endless }), { code: 'upstream_error' });
});
