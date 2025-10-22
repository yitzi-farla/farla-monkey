// ==UserScript==
// @name         TradePeg SO Validator
// @namespace    farla.tradepeg.validator
// @version      1.0.0
// @description  Enforce Sales Order rules on the SO create page only; robust carrier check
// @author       Farla
// @match        https://farla2.tradepeg.net/app/en-gb/doc/so/0
// @match        https://farla2.tradepeg.net/app/en-gb/doc/so/0?*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // --- tiny badge so you see it loaded ---
  function badge(text, color) {
    var b = document.getElementById("__so_val_badge__");
    if (!b) {
      b = document.createElement("div");
      b.id = "__so_val_badge__";
      b.style.position = "fixed";
      b.style.right = "8px";
      b.style.bottom = "8px";
      b.style.zIndex = "999999";
      b.style.background = color || "#0d6efd";
      b.style.color = "#fff";
      b.style.padding = "6px 10px";
      b.style.borderRadius = "999px";
      b.style.font = "12px system-ui, Segoe UI, Arial, sans-serif";
      b.style.boxShadow = "0 4px 14px rgba(0,0,0,.18)";
      document.documentElement.appendChild(b);
    }
    b.textContent = text;
  }

  // --- selectors only for this page ---
  var SELECTORS = {
    name:    '#shipping-name, input[name="shipping-name"]',
    phone:   '#shipping-phone, input[name="shipping-phone"]',
    email:   '#shipping-email, input[name="shipping-email"]',
    carrier: 'select[name="carrierId"], select#carrierId',
    saveBtn: 'a.btn.btn-sm.btn-success.postform2, a.postform2'
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function normSpaces(s) { return (s || "").replace(/\s{2,}/g, " ").trim(); }

  // add missing id/name/autocomplete (helps autofill + stability)
  function ensureAttrs() {
    var pairs = [
      { sel: SELECTORS.name,    id: "shipping-name",  name: "shipping-name",  ac: "name" },
      { sel: SELECTORS.email,   id: "shipping-email", name: "shipping-email", ac: "email" },
      { sel: SELECTORS.phone,   id: "shipping-phone", name: "shipping-phone", ac: "tel" },
      { sel: SELECTORS.carrier, id: "carrierId",      name: "carrierId",      ac: "off" }
    ];
    for (var i = 0; i < pairs.length; i++) {
      var el = $(pairs[i].sel);
      if (!el) continue;
      if (!el.id) el.id = pairs[i].id;
      if (!el.name) el.name = pairs[i].name;
      if (pairs[i].ac && !el.getAttribute("autocomplete")) el.setAttribute("autocomplete", pairs[i].ac);
    }
  }

  function setInvalid(el, why) {
    if (!el) return;
    el.style.outline = "2px solid #dc3545";
    el.style.outlineOffset = "1px";
    if (why) el.title = why;
  }
  function clearInvalid(el) {
    if (!el) return;
    el.style.outline = "";
    el.style.outlineOffset = "";
  }

  function attachNormalizers() {
    var name = $(SELECTORS.name);
    var email = $(SELECTORS.email);
    var phone = $(SELECTORS.phone);

    if (name && !name.dataset._norm) {
      name.dataset._norm = "1";
      name.addEventListener("blur", function () { name.value = normSpaces(name.value); });
      name.addEventListener("input", function () { name.value = name.value.replace(/\s{2,}/g, " "); });
    }
    if (email && !email.dataset._norm) {
      email.dataset._norm = "1";
      email.addEventListener("blur", function () { email.value = normSpaces(email.value); });
      email.addEventListener("input", function () { email.value = email.value.replace(/\s{2,}/g, " "); });
    }
    if (phone && !phone.dataset._norm) {
      phone.dataset._norm = "1";
      var strip = function () { phone.value = (phone.value || "").replace(/\s+/g, ""); };
      phone.addEventListener("blur", strip);
      phone.addEventListener("input", strip);
    }
  }

  // robust carrier blank detection
  function isCarrierBlank(selEl) {
    if (!selEl) return true;
    var v = (selEl.value || "").trim();
    var selected = selEl.options && selEl.options[selEl.selectedIndex];
    var bad = { "":1, "0":1, "-1":1, "null":1, "undefined":1 };
    if (bad[v]) return true;
    if (selEl.selectedIndex === 0) return true; // often placeholder
    if (selected && (selected.disabled || selected.hidden)) return true;
    var txt = selected ? (selected.textContent || "") : "";
    txt = txt.toLowerCase().trim();
    if (!txt || txt === "-" || txt === "—" || /^select( a)? carrier|choose|please select/.test(txt)) return true;
    return false;
  }

  function validateAll() {
    var nameEl    = $(SELECTORS.name);
    var phoneEl   = $(SELECTORS.phone);
    var emailEl   = $(SELECTORS.email);
    var carrierEl = $(SELECTORS.carrier);

    clearInvalid(nameEl); clearInvalid(phoneEl); clearInvalid(emailEl); clearInvalid(carrierEl);

    if (nameEl)  nameEl.value  = normSpaces(nameEl.value);
    if (emailEl) emailEl.value = normSpaces(emailEl.value);
    if (phoneEl) phoneEl.value = (phoneEl.value || "").replace(/\s+/g, "");

    var issues = [];
    var dbl = function (s) { return /\s{2,}/.test(s || ""); };

    if (nameEl && dbl(nameEl.value)) { issues.push("Name contains double spaces."); setInvalid(nameEl, "Remove double spaces"); }
    if (emailEl && dbl(emailEl.value)) { issues.push("Email contains double spaces."); setInvalid(emailEl, "Remove double spaces"); }

    var email = (emailEl && emailEl.value.trim()) || "";
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
    if (!email) { issues.push("Email is required."); setInvalid(emailEl, "Email is required"); }
    else if (!emailRx.test(email)) { issues.push("Email format looks invalid."); setInvalid(emailEl, "Invalid email"); }

    var phone = (phoneEl && phoneEl.value.trim()) || "";
    if (!phone) { issues.push("Phone number is required."); setInvalid(phoneEl, "Phone required"); }
    else {
      var allowed = /^[0-9()+\-./x]*$/i;
      if (!allowed.test(phone)) { issues.push("Phone has unexpected characters (allowed: digits, + ( ) - . / x)."); setInvalid(phoneEl, "Unexpected chars"); }
      if (phone.replace(/\D/g, "").length < 7) { issues.push("Phone looks too short (min ~7 digits)."); setInvalid(phoneEl, "Too short"); }
    }

    var name = (nameEl && nameEl.value.trim()) || "";
    if (!name) { issues.push("Shipping name is required."); setInvalid(nameEl, "Name required"); }
    else if (name.length >= 35) { issues.push("Name must be under 35 characters (currently " + name.length + ")."); setInvalid(nameEl, "Under 35 chars"); }

    if (isCarrierBlank(carrierEl)) { issues.push("Please select a carrier."); setInvalid(carrierEl, "Carrier required"); }

    return issues;
  }

  function showIssues(issues) {
    alert("Please fix the following before saving:\n\n" + issues.map(function (t, i) { return (i + 1) + ". " + t; }).join("\n"));
    badge("Validation blocked", "#dc3545");
  }

  function bind() {
    ensureAttrs();
    attachNormalizers();

    var saveBtn = $(SELECTORS.saveBtn);
    var form = (saveBtn && saveBtn.closest("form")) || document.querySelector("form.form");

    if (saveBtn && !saveBtn.dataset._soBind) {
      saveBtn.dataset._soBind = "1";
      saveBtn.addEventListener("click", function (evt) {
        var issues = validateAll();
        if (issues.length) {
          evt.preventDefault();
          evt.stopPropagation();
          if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
          showIssues(issues);
          console.log("[SO-Validator] Blocked Save (button)", issues);
        }
      }, true);
    }

    if (form && !form.dataset._soBind) {
      form.dataset._soBind = "1";
      form.addEventListener("submit", function (evt) {
        var issues = validateAll();
        if (issues.length) {
          evt.preventDefault();
          if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
          showIssues(issues);
          console.log("[SO-Validator] Blocked Save (form submit)", issues);
        }
      }, true);
    }
  }

  (async function main() {
    badge("SO Validator ON");
    console.log("[SO-Validator] Active on", location.href);

    // wait a bit for SPA to render elements
    for (var i = 0; i < 30; i++) {
      bind();
      var ready = $(SELECTORS.name) && $(SELECTORS.email) && $(SELECTORS.phone) && $(SELECTORS.carrier) && $(SELECTORS.saveBtn);
      if (ready) break;
      await sleep(200);
    }

    // watch for rerenders on this page
    var mo = new MutationObserver(function () { bind(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    console.log("[SO-Validator] Ready.");
    badge("SO Validator ready ✅");
  })();
})();
