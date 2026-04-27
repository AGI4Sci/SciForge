#!/usr/bin/env python3
import hashlib
import html
from html.parser import HTMLParser
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def main():
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    with open(input_path, "r", encoding="utf-8") as handle:
        task_input = json.load(handle)
    prompt = str(task_input.get("prompt") or "")
    query = web_query(prompt)
    results, provider, provider_url = search_arxiv(query, prompt) if arxiv_requested(prompt) else search_web(query)
    papers = [paper_from_result(item, index, provider) for index, item in enumerate(results[:8])]
    wants_report = report_requested(prompt)
    artifacts = ["paper-list"]
    if wants_report:
        artifacts.insert(0, "research-report")
    status = "done"
    search_label = "arXiv search" if provider.startswith("arXiv") else "Web search"
    message = (
        f"{search_label} returned {len(papers)} records for: {query}"
        if papers
        else f"{search_label} returned no records for: {query}"
    )
    payload = {
        "message": message,
        "confidence": 0.78 if papers else 0.45,
        "claimType": "fact" if papers else "inference",
        "evidenceLevel": "arxiv-api" if provider.startswith("arXiv") else "web-search",
        "reasoningTrace": (
            "Seed skill literature.web_search respected an explicit web/Google/browser search request. "
            f"It used provider={provider} via a reproducible workspace network task, not PubMed E-utilities. "
            "AgentServer documents the same separation: network primitives such as web_search should route to a network-capable backend/worker, while workspace tasks own artifacts."
        ),
        "claims": [
            {
                "text": f"{paper['title']} was found by {provider} for {query}.",
                "type": "fact",
                "confidence": 0.72,
                "evidenceLevel": paper.get("evidenceLevel") or ("arxiv-api" if provider.startswith("arXiv") else "web-search"),
                "supportingRefs": [paper["url"]],
                "opposingRefs": [],
            }
            for paper in papers
        ],
        "uiManifest": ui_manifest(wants_report),
        "executionUnits": [
            execution_unit(
                "literature-evidence-review",
                "web_search",
                {"query": query, "provider": provider, "providerUrl": provider_url},
                status,
                [provider],
                artifacts,
            )
        ],
        "artifacts": (report_artifacts(query, provider, provider_url, papers) if wants_report else []) + [
            {
                "id": "paper-list",
                "type": "paper-list",
                "producerScenario": "literature-evidence-review",
                "schemaVersion": "1",
                "metadata": {"query": query, "source": provider, "providerUrl": provider_url, "accessedAt": now()},
                "data": {
                    "query": query,
                    "sourceRefs": [{"provider": provider, "url": provider_url}],
                    "papers": papers,
                },
            }
        ],
    }
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def web_query(prompt):
    explicit = re.search(r"\bquery\s*=\s*([^。\n;；]+)", prompt, flags=re.I)
    if explicit:
        return clean_query_text(explicit.group(1))
    text = prompt
    text = re.sub(r"通过\s*(?:google|谷歌|浏览器|本地浏览器|web|网页|互联网)\s*(?:搜索|检索|查找)?", " ", text, flags=re.I)
    text = re.sub(r"^\s*(?:一下|一下子|下)\s*", " ", text)
    text = re.sub(r"(?:use|through|via)\s+(?:google|browser|web)\s+(?:search|lookup|find)", " ", text, flags=re.I)
    text = re.sub(r"(?:google|谷歌|browser|web|网页|互联网)\s*(?:search|检索|搜索|查找)", " ", text, flags=re.I)
    text = re.sub(r"返回.*$", "", text)
    text = re.sub(r"^\s*场景\s*[:：]\s*", " ", text)
    text = re.sub(r"帮我|请|阅读并?|读完|写一份|撰写|调研|相关|按照要求|系统性(?:整理|总结)?|写成报告|生成报告|总结一下|总结|报告", " ", text)
    text = re.sub(r"在?\s*arxiv\s*上?|今天|今日|最新(?:的)?|论文|papers?", " ", text, flags=re.I)
    query = clean_query_text(text)
    if re.fullmatch(r"agent|agents", query, flags=re.I):
        return "AI agent"
    return query


def report_requested(prompt):
    return re.search(r"report|summary|summari[sz]e|systematic|报告|总结|系统性|整理", prompt, flags=re.I) is not None


def arxiv_requested(prompt):
    return re.search(r"\barxiv\b|arxiv上|最新论文", prompt, flags=re.I) is not None


def ui_manifest(wants_report):
    base = []
    priority = 1
    if wants_report:
        base.append({"componentId": "report-viewer", "title": "Search report", "artifactRef": "research-report", "priority": priority})
        priority += 1
    base.extend([
        {"componentId": "paper-card-list", "title": "Web search results", "artifactRef": "paper-list", "priority": priority},
        {"componentId": "evidence-matrix", "title": "Evidence", "artifactRef": "paper-list", "priority": priority + 1},
        {"componentId": "execution-unit-table", "title": "Execution units", "artifactRef": "paper-list", "priority": priority + 2},
        {"componentId": "notebook-timeline", "title": "Research record", "artifactRef": "paper-list", "priority": priority + 3},
    ])
    return base


def report_artifacts(query, provider, provider_url, papers):
    markdown = build_report_markdown(query, provider, papers)
    return [
        {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"query": query, "source": provider, "providerUrl": provider_url, "accessedAt": now()},
            "data": {
                "query": query,
                "markdown": markdown,
                "sections": [
                    {"title": "检索范围", "content": f"Provider: {provider}; query: {query}."},
                    {"title": "主要结果", "content": "\\n".join([f"- {paper['title']} ({paper['url']})" for paper in papers]) or "未解析到可用结果。"},
                    {"title": "局限性", "content": "这是元数据和摘要级别的初步报告，不等价于全文系统综述。"},
                ],
                "sourceRefs": [{"provider": provider, "url": provider_url}],
            },
        }
    ]


def build_report_markdown(query, provider, papers):
    lines = [
        f"# arXiv 最新论文检索报告",
        "",
        f"- 检索 query：{query}",
        f"- 检索来源：{provider}",
        f"- 结果数量：{len(papers)}",
        "",
        "## 候选论文/来源",
    ]
    if papers:
        for index, paper in enumerate(papers, start=1):
            lines.extend([
                f"{index}. **{paper['title']}**",
                f"   - URL: {paper['url']}",
                f"   - Source: {paper['source']}",
            ])
    else:
        lines.append("未解析到可用结果。")
    lines.extend([
        "",
        "## 初步解读",
        "这些结果来自可复现检索任务，适合快速发现候选论文。正式系统综述还需要后续下载 PDF、读取全文、按主题聚类，并对方法和实验结论做人工复核。",
        "",
        "## 下一步建议",
        "- 将候选条目按真实 arXiv ID 去重。",
        "- 下载 PDF 或摘要后提取任务、方法、数据集和主要结论。",
        "- 将结论分为事实、推断和假设，并保留来源链接。",
    ])
    return "\\n".join(lines)


def clean_query_text(text):
    text = re.sub(r"paper-card-list|paper-list|evidence matrix|execution unit|uiManifest|JSON|artifact|claims", " ", text, flags=re.I)
    text = re.sub(r"\bmaxResults\s*=\s*\d+", " ", text, flags=re.I)
    text = re.sub(r"搜索|检索|查找|按照要求", " ", text)
    text = re.sub(r"^[，,、和\s]+|[，,、和\s]+$", " ", text)
    text = re.sub(r"\s*[.。]\s*$", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text in {"搜索", "检索", "查找"}:
        text = ""
    return text[:220] or "cat:*"


def search_arxiv(query, prompt):
    today = time.strftime("%Y%m%d", time.gmtime())
    base_query = arxiv_query(query)
    max_results = max_results_from_prompt(prompt)
    queries = []
    if re.search(r"today|今天|今日", prompt, flags=re.I):
        queries.append((
            f"arXiv API today submittedDate {today}",
            f"submittedDate:[{today}0000 TO {today}2359] AND ({base_query})",
        ))
    queries.append(("arXiv API latest submittedDate", base_query))
    errors = []
    for provider, search_query in queries:
        url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({
            "search_query": search_query,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "start": 0,
            "max_results": max_results,
        })
        try:
            results = parse_arxiv_feed(fetch_text(url), provider)
            if results:
                return results, provider, url
            errors.append(f"{provider}: no entries")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}: {exc}")
    recent_results, recent_provider, recent_url = search_arxiv_recent_pages(max_results, errors)
    if recent_results:
        return recent_results, recent_provider, recent_url
    return [{
        "title": f"No arXiv records parsed for {query}",
        "url": "https://export.arxiv.org/api/query",
        "snippet": "arXiv API returned no parseable entries. " + " | ".join(errors)[:800],
        "authors": [],
        "year": "",
        "published": "",
        "updated": "",
        "categories": [],
    }], "arXiv API fallback", "https://export.arxiv.org/api/query"


def search_arxiv_recent_pages(max_results, api_errors):
    categories = ["cs.AI", "cs.LG", "q-bio.BM", "q-bio.QM", "stat.ML"]
    papers = []
    refs = []
    errors = []
    for category in categories:
        if len(papers) >= max_results:
            break
        url = f"https://arxiv.org/list/{category}/recent"
        try:
            parsed = parse_arxiv_recent_page(fetch_text(url), category)
            papers.extend(parsed)
            refs.append(url)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{category}: {exc}")
    if papers:
        provider = "arXiv recent pages"
        if api_errors:
            provider += " after API fallback"
        return papers[:max_results], provider, refs[0] if refs else "https://arxiv.org/list/cs.AI/recent"
    api_errors.extend(errors)
    return [], "arXiv recent pages", "https://arxiv.org/list/cs.AI/recent"


def parse_arxiv_recent_page(text, category):
    id_matches = list(re.finditer(r'<a[^>]+href="(/abs/[^"]+)"[^>]*>(?:arXiv:)?([^<]+)</a>', text, flags=re.I))
    titles = [clean_html_text(match.group(1)) for match in re.finditer(r'<div[^>]+class="list-title[^"]*"[^>]*>\\s*<span[^>]*>Title:</span>\\s*([\\s\\S]*?)</div>', text, flags=re.I)]
    authors = [clean_html_text(match.group(1)) for match in re.finditer(r'<div[^>]+class="list-authors[^"]*"[^>]*>\\s*<a[\\s\\S]*?</span>\\s*([\\s\\S]*?)</div>', text, flags=re.I)]
    papers = []
    seen = set()
    for index, match in enumerate(id_matches):
        href = match.group(1)
        arxiv_id = clean_html_text(match.group(2))
        if href in seen:
            continue
        seen.add(href)
        title = titles[index] if index < len(titles) and titles[index] else f"arXiv {arxiv_id}"
        author_text = authors[index] if index < len(authors) else ""
        papers.append({
            "pmid": "",
            "title": title,
            "authors": [name.strip() for name in re.split(r",| and ", author_text) if name.strip()][:20],
            "journal": "arXiv",
            "year": "",
            "url": "https://arxiv.org" + href,
            "abstract": f"Recent arXiv listing entry {arxiv_id} in {category}.",
            "evidenceLevel": "arxiv-recent-page",
            "source": "arXiv recent pages",
            "published": "",
            "updated": "",
            "categories": [category],
        })
    return papers


def arxiv_query(query):
    if not query or query == "cat:*":
        return "cat:*"
    if re.match(r"^(all|ti|abs|au|cat):", query, flags=re.I):
        return query
    return "all:" + quote_arxiv_term(query)


def quote_arxiv_term(query):
    clean = re.sub(r"[^A-Za-z0-9_\-\s]", " ", query).strip()
    if not clean:
        return "*"
    if " " in clean:
        return '"' + clean[:120] + '"'
    return clean[:120]


def max_results_from_prompt(prompt):
    match = re.search(r"(?:maxResults|最多|前)\s*=?\s*(\d{1,2})", prompt, flags=re.I)
    if not match:
        return 8
    return max(1, min(20, int(match.group(1))))


def parse_arxiv_feed(text, provider):
    root = ET.fromstring(text)
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "arxiv": "http://arxiv.org/schemas/atom",
    }
    papers = []
    for index, entry in enumerate(root.findall("atom:entry", ns)):
        title = clean_html_text(entry.findtext("atom:title", default="", namespaces=ns))
        url = clean_html_text(entry.findtext("atom:id", default="", namespaces=ns))
        abstract = clean_html_text(entry.findtext("atom:summary", default="", namespaces=ns))
        published = clean_html_text(entry.findtext("atom:published", default="", namespaces=ns))
        updated = clean_html_text(entry.findtext("atom:updated", default="", namespaces=ns))
        authors = [
            clean_html_text(author.findtext("atom:name", default="", namespaces=ns))
            for author in entry.findall("atom:author", ns)
        ]
        categories = [
            category.attrib.get("term", "")
            for category in entry.findall("atom:category", ns)
            if category.attrib.get("term")
        ]
        papers.append({
            "pmid": "",
            "title": title or f"arXiv result {index + 1}",
            "authors": [author for author in authors if author],
            "journal": "arXiv",
            "year": published[:4],
            "url": url,
            "abstract": abstract,
            "evidenceLevel": "arxiv-api",
            "source": provider,
            "published": published,
            "updated": updated,
            "categories": categories,
        })
    return papers


def search_web(query):
    providers = [
        ("DuckDuckGo HTML", f"https://duckduckgo.com/html/?{urllib.parse.urlencode({'q': query})}", parse_duckduckgo),
        ("Bing Web", f"https://www.bing.com/search?{urllib.parse.urlencode({'q': query})}", parse_bing),
        ("Google Web", f"https://www.google.com/search?{urllib.parse.urlencode({'q': query})}", parse_google),
    ]
    errors = []
    for provider, url, parser in providers:
        try:
            text = fetch_text(url)
            results = parser(text)
            if results:
                return results, provider, url
            errors.append(f"{provider}: no parseable results")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}: {exc}")
    return [{
        "title": f"No web search results parsed for {query}",
        "url": providers[0][1],
        "snippet": "Search providers were reachable only partially or returned an unparseable page. " + " | ".join(errors)[:800],
    }], "web_search-fallback", providers[0][1]


def fetch_text(url):
    request = urllib.request.Request(url, headers={
        "User-Agent": "BioAgent/0.1 (research workflow; contact: example@example.invalid)",
        "Accept": "application/atom+xml,text/html,application/xhtml+xml",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self._current = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        href = attrs_dict.get("href")
        css = attrs_dict.get("class", "")
        if tag == "a" and href and is_result_href(href, css):
            self._current = normalize_href(href)
            self._buf = []

    def handle_data(self, data):
        if self._current:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._current:
            title = clean_html_text(" ".join(self._buf))
            if title and len(title) > 3:
                self.links.append({"title": title, "url": self._current, "snippet": ""})
            self._current = None
            self._buf = []


def parse_duckduckgo(text):
    parser = LinkParser()
    parser.feed(text)
    return dedupe_results(parser.links)


def parse_bing(text):
    results = []
    for match in re.finditer(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', text, flags=re.I | re.S):
        results.append({
            "title": clean_html_text(match.group(2)),
            "url": html.unescape(match.group(1)),
            "snippet": "",
        })
    return dedupe_results(results or parse_duckduckgo(text))


def parse_google(text):
    results = []
    for match in re.finditer(r'<a href="/url\?q=([^"&]+)[^"]*"[^>]*>(.*?)</a>', text, flags=re.I | re.S):
        results.append({
            "title": clean_html_text(match.group(2)),
            "url": urllib.parse.unquote(match.group(1)),
            "snippet": "",
        })
    return dedupe_results(results or parse_duckduckgo(text))


def is_result_href(href, css):
    if href.startswith("#") or href.startswith("/"):
        return "result__a" in css
    return href.startswith("http") and not any(skip in href for skip in ["duckduckgo.com/y.js", "bing.com/search", "google.com/search"])


def normalize_href(href):
    if href.startswith("//duckduckgo.com/l/"):
        parsed = urllib.parse.urlparse("https:" + href)
        params = urllib.parse.parse_qs(parsed.query)
        uddg = params.get("uddg", [""])[0]
        return urllib.parse.unquote(uddg) or "https:" + href
    if href.startswith("/l/?"):
        parsed = urllib.parse.urlparse(href)
        params = urllib.parse.parse_qs(parsed.query)
        uddg = params.get("uddg", [""])[0]
        return urllib.parse.unquote(uddg) or href
    return html.unescape(href)


def clean_html_text(text):
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def dedupe_results(results):
    out = []
    seen = set()
    for item in results:
        url = str(item.get("url") or "")
        title = str(item.get("title") or "")
        if not url or not title or url in seen:
            continue
        seen.add(url)
        out.append(item)
        if len(out) >= 8:
            break
    return out


def paper_from_result(item, index, provider):
    title = str(item.get("title") or f"Web result {index + 1}")
    url = str(item.get("url") or "")
    snippet = str(item.get("snippet") or item.get("abstract") or title)
    evidence_level = str(item.get("evidenceLevel") or ("arxiv-api" if provider.startswith("arXiv API") else "web-search"))
    return {
        "pmid": "",
        "title": title,
        "authors": item.get("authors") if isinstance(item.get("authors"), list) else [],
        "journal": str(item.get("journal") or provider),
        "year": str(item.get("year") or ""),
        "url": url,
        "abstract": snippet,
        "evidenceLevel": evidence_level,
        "source": provider,
        "published": str(item.get("published") or ""),
        "updated": str(item.get("updated") or ""),
        "categories": item.get("categories") if isinstance(item.get("categories"), list) else [],
    }


def execution_unit(agent_id, tool, params, status, database_versions, artifacts):
    digest = hashlib.sha1(json.dumps({"tool": tool, "params": params}, sort_keys=True).encode("utf-8")).hexdigest()[:10]
    return {
        "id": f"EU-{agent_id}-{digest}",
        "tool": tool,
        "params": json.dumps(params, ensure_ascii=False),
        "status": status,
        "hash": digest,
        "time": now(),
        "environment": "BioAgent workspace Python task",
        "databaseVersions": database_versions,
        "artifacts": artifacts,
        "outputArtifacts": artifacts,
    }


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    main()
