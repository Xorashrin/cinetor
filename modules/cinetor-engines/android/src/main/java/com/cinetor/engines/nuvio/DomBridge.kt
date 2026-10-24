// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines.nuvio

import com.cinetor.engines.*
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.function
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import java.util.IdentityHashMap

/** Request-local HTML documents; no Android object or filesystem handle reaches JS. */
internal class DomBridge : AutoCloseable {
    private data class Dom(val document: Document, val ids: IdentityHashMap<Element, String> = IdentityHashMap(),
                           val elements: MutableMap<String, Element> = mutableMapOf())
    private val documents = mutableMapOf<String, Dom>()
    private var htmlBytes = 0
    private var nodes = 0

    private fun arg(args: Array<Any?>, index: Int) = args.getOrNull(index)?.toString() ?: ""
    private fun dom(id: String) = documents[id] ?: throw EngineFailure("MALFORMED", "Unknown HTML document")
    private fun element(doc: Dom, id: String) = doc.elements[id] ?: throw EngineFailure("MALFORMED", "Unknown HTML element")
    private fun selector(raw: String): String {
        requireEngine(raw.length <= 512, "LIMIT", "HTML selector exceeds the budget")
        requireEngine(!raw.contains(":matches", true) && !raw.contains("~="),
            "UNSUPPORTED_DOM", "Regex-based native HTML selectors are excluded from the bounded host profile")
        return raw
    }
    private fun id(doc: Dom, element: Element): String = doc.ids[element] ?: run {
        requireEngine(doc.ids.size < 8192, "LIMIT", "HTML element handle budget exceeded")
        val id = doc.ids.size.toString()
        doc.ids[element] = id
        doc.elements[id] = element
        id
    }
    private fun ids(doc: Dom, elements: Iterable<Element>): String {
        val list = elements.toList()
        requireEngine(list.size <= 4096, "LIMIT", "HTML selection exceeds the budget")
        return Json.encode(list.map { id(doc, it) })
    }
    private fun bounded(text: String): String {
        requireEngine(text.toByteArray(Charsets.UTF_8).size <= Limits.BODY, "LIMIT", "HTML result exceeds the budget")
        return text
    }

    fun register(runtime: QuickJs, guard: ((() -> Any?) -> Any?)) {
        fun bind(name: String, block: (Array<Any?>) -> Any?) {
            runtime.function(name) { args -> guard { block(args) } }
        }
        bind("__cheerio_load") { args ->
            val html = arg(args, 0)
            htmlBytes += html.toByteArray(Charsets.UTF_8).size
            requireEngine(documents.size < 8 && htmlBytes <= 2 * Limits.BODY && html.count { it == '<' } <= 32768,
                "LIMIT", "HTML document budget exceeded")
            val document = Jsoup.parse(html)
            nodes += document.getAllElements().size
            requireEngine(nodes <= 32768, "LIMIT", "HTML node budget exceeded")
            val key = documents.size.toString()
            documents[key] = Dom(document)
            key
        }
        bind("__cheerio_select") { args -> val doc = dom(arg(args, 0)); ids(doc, doc.document.select(selector(arg(args, 1)))) }
        bind("__cheerio_find") { args -> val doc = dom(arg(args, 0)); val root = element(doc, arg(args, 1))
            ids(doc, root.select(selector(arg(args, 2))).filter { it !== root }) }
        bind("__cheerio_text") { args -> val doc = dom(arg(args, 0)); bounded(arg(args, 1).split(',').joinToString("") { element(doc, it).text() }) }
        bind("__cheerio_html") { args -> val doc = dom(arg(args, 0)); val key = arg(args, 1)
            bounded(if (key.isEmpty()) doc.document.html() else element(doc, key).outerHtml()) }
        bind("__cheerio_inner_html") { args -> bounded(element(dom(arg(args, 0)), arg(args, 1)).html()) }
        bind("__cheerio_attr") { args -> val element = element(dom(arg(args, 0)), arg(args, 1)); val name = arg(args, 2)
            if (element.hasAttr(name)) bounded(element.attr(name)) else "__UNDEFINED__" }
        bind("__cheerio_next") { args -> val doc = dom(arg(args, 0)); element(doc, arg(args, 1)).nextElementSibling()?.let { id(doc, it) } ?: "__NONE__" }
        bind("__cheerio_prev") { args -> val doc = dom(arg(args, 0)); element(doc, arg(args, 1)).previousElementSibling()?.let { id(doc, it) } ?: "__NONE__" }
        bind("__cheerio_parent") { args -> val doc = dom(arg(args, 0)); element(doc, arg(args, 1)).parent()?.let { id(doc, it) } ?: "__NONE__" }
        bind("__cheerio_children") { args -> val doc = dom(arg(args, 0)); ids(doc, element(doc, arg(args, 1)).children().filter { it.`is`(selector(arg(args, 2))) }) }
        bind("__cheerio_matches") { args -> element(dom(arg(args, 0)), arg(args, 1)).`is`(selector(arg(args, 2))) }
    }

    override fun close() { documents.clear() }

    companion object {
        val domParser = """
            function __dom_node(doc, id) {
                return {
                    get textContent() { return __cheerio_text(doc, id); },
                    get innerHTML() { return __cheerio_inner_html(doc, id); },
                    get outerHTML() { return __cheerio_html(doc, id); },
                    getAttribute: function(name) { var v = __cheerio_attr(doc, id, name); return v === '__UNDEFINED__' ? null : v; },
                    querySelectorAll: function(s) { return JSON.parse(__cheerio_find(doc, id, s)).map(function(i) { return __dom_node(doc, i); }); },
                    querySelector: function(s) { return this.querySelectorAll(s)[0] || null; }
                };
            }
            globalThis.DOMParser = function() {};
            DOMParser.prototype.parseFromString = function(html, type) {
                if (type !== 'text/html') return __unsupported('XML DOMParser');
                var doc = __cheerio_load(String(html));
                return {
                    querySelectorAll: function(s) { return JSON.parse(__cheerio_select(doc, s)).map(function(i) { return __dom_node(doc, i); }); },
                    querySelector: function(s) { return this.querySelectorAll(s)[0] || null; },
                    get documentElement() { return this.querySelector('html'); },
                    get body() { return this.querySelector('body'); }
                };
            };
        """.trimIndent()
    }
}
