let isScraping = false;
let isSelecting = false;
let observer = null;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    try {
      isScraping = true;
      const { dataTypes, selector } = message;
      const validatedSelector = validateSelector(selector);
      const data = scrapeData(dataTypes, validatedSelector);
      startObserver(dataTypes, validatedSelector);
      sendResponse({ data, status: 'Scraping started successfully.' });
    } catch (error) {
      console.error('Scraping error:', error);
      sendResponse({ data: null, status: `Error: ${error.message}` });
    }
  } else if (message.action === 'stopScraping') {
    isScraping = false;
    stopObserver();
    sendResponse({ status: 'Scraping stopped.' });
  } else if (message.action === 'startSelecting') {
    isSelecting = true;
    startElementSelection();
    sendResponse({ status: 'Element selection started.' });
  } else if (message.action === 'stopSelecting') {
    isSelecting = false;
    stopElementSelection();
    sendResponse({ status: 'Element selection stopped.' });
  }
});

// Validate CSS or XPath selector
function validateSelector(selector) {
  if (!selector || typeof selector !== 'string') {
    return '*'; // Default to all elements
  }
  try {
    if (selector.startsWith('/')) {
      document.evaluate(selector, document, null, XPathResult.ANY_TYPE, null);
    } else {
      document.querySelectorAll(selector);
    }
    return selector;
  } catch (error) {
    console.warn(`Invalid selector: ${selector}. Falling back to '*'`);
    return '*';
  }
}

// Generate a unique CSS selector for an element
function generateSelector(element) {
  if (!element || !element.tagName) return '';
  const path = [];
  let current = element;
  while (current && current !== document) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).map(c => `.${c}`).join('');
      selector += classes;
    }
    const siblings = Array.from(current.parentNode?.children || []).filter(
      sib => sib.tagName === current.tagName && sib !== current
    );
    if (siblings.length) {
      const index = Array.from(current.parentNode.children).indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }
    path.unshift(selector);
    current = current.parentNode;
  }
  return path.join(' > ');
}

// Handle element hover and selection
function startElementSelection() {
  stopElementSelection(); // Clear existing listeners
  document.addEventListener('mouseover', handleMouseOver, { capture: true });
  document.addEventListener('mouseout', handleMouseOut, { capture: true });
}

function stopElementSelection() {
  document.removeEventListener('mouseover', handleMouseOver, { capture: true });
  document.removeEventListener('mouseout', handleMouseOut, { capture: true });
  removeHighlights();
}

function handleMouseOver(event) {
  if (!isSelecting) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.target;
  if (element === document.body || element === document.documentElement) return;
  highlightElement(element);
  const selector = generateSelector(element);
  chrome.runtime.sendMessage({
    action: 'elementHovered',
    tag: element.tagName.toLowerCase(),
    class: element.className || '',
    selector
  });
}

function handleMouseOut(event) {
  if (!isSelecting) return;
  removeHighlights();
}

function highlightElement(element) {
  removeHighlights();
  element.style.outline = '2px solid blue';
  element.style.outlineOffset = '2px';
  element.dataset.scraperHighlight = 'true';
}

function removeHighlights() {
  document.querySelectorAll('[data-scraper-highlight="true"]').forEach(el => {
    el.style.outline = '';
    el.style.outlineOffset = '';
    delete el.dataset.scraperHighlight;
  });
}

// Main scraping function
function scrapeData(dataTypes, selector, retryCount = 0) {
  const data = { text: [], images: [], links: [], tables: [], status: '' };
  let elements = [];

  try {
    // Handle CSS or XPath selectors
    if (selector.startsWith('/')) {
      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        elements.push(result.snapshotItem(i));
      }
    } else {
      elements = Array.from(document.querySelectorAll(selector));
    }

    // Include elements from shadow DOM
    elements = elements.concat(getShadowDomElements(selector));
    // Include elements from iframes (if accessible)
    elements = elements.concat(getIframeElements(selector));

    // Process elements in chunks to avoid performance issues
    const chunkSize = 100;
    for (let i = 0; i < elements.length; i += chunkSize) {
      const chunk = elements.slice(i, i + chunkSize);
      processElements(chunk, dataTypes, selector, data);
    }

    // Retry for dynamic content if data is empty and retries remain
    if (isDataEmpty(data) && retryCount < MAX_RETRIES) {
      if (retryCount === 0) {
        data.status = 'Waiting for dynamic content...';
      }
      setTimeout(() => {
        if (isScraping) {
          const retryData = scrapeData(dataTypes, selector, retryCount + 1);
          chrome.runtime.sendMessage({ action: 'updateData', data: retryData });
        }
      }, RETRY_DELAY);
    } else if (isDataEmpty(data)) {
      data.status = 'No data found for the given selector.';
    } else {
      data.status = 'Data scraped successfully.';
    }

  } catch (error) {
    console.error('Error during scraping:', error);
    data.status = `Error: ${error.message}`;
  }

  return data;
}

// Process elements for scraping
function processElements(elements, dataTypes, selector, data) {
  elements.forEach(el => {
    if (dataTypes.text && ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'DIV'].includes(el.tagName)) {
      const content = el.textContent.trim();
      if (content) data.text.push({ content, selector, tag: el.tagName.toLowerCase() });
    }
    if (dataTypes.images && el.tagName === 'IMG' && el.src) {
      data.images.push({ src: el.src, alt: el.alt || '', selector });
    }
    if (dataTypes.links && el.tagName === 'A' && el.href) {
      data.links.push({ href: el.href, text: el.textContent.trim(), selector });
    }
    if (dataTypes.tables && el.tagName === 'TABLE') {
      const rows = [];
      const trs = el.querySelectorAll('tr');
      trs.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td, th')).map(cell => cell.textContent.trim());
        if (cells.length) rows.push(cells);
      });
      if (rows.length) data.tables.push({ rows, selector });
    }
  });
}

// Check if scraped data is empty
function isDataEmpty(data) {
  return (
    data.text.length === 0 &&
    data.images.length === 0 &&
    data.links.length === 0 &&
    data.tables.length === 0
  );
}

// Get elements from shadow DOM
function getShadowDomElements(selector) {
  const elements = [];
  const walker = document.createTreeWalker(document.body, Node.ELEMENT_NODE, {
    acceptNode: (node) => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
  });

  let node;
  while ((node = walker.nextNode())) {
    if (node.shadowRoot) {
      try {
        if (selector.startsWith('/')) {
          const result = document.evaluate(selector, node.shadowRoot, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < result.snapshotLength; i++) {
            elements.push(result.snapshotItem(i));
          }
        } else {
          elements.push(...node.shadowRoot.querySelectorAll(selector));
        }
      } catch (error) {
        console.warn(`Error accessing shadow DOM: ${error.message}`);
      }
    }
  }
  return elements;
}

// Get elements from iframes
function getIframeElements(selector) {
  const elements = [];
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      if (iframeDoc) {
        if (selector.startsWith('/')) {
          const result = document.evaluate(selector, iframeDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < result.snapshotLength; i++) {
            elements.push(result.snapshotItem(i));
          }
        } else {
          elements.push(...iframeDoc.querySelectorAll(selector));
        }
      }
    } catch (error) {
      console.warn(`Error accessing iframe: ${error.message}`);
    }
  });
  return elements;
}

// Observe DOM changes for dynamic content
function startObserver(dataTypes, selector) {
  stopObserver();
  observer = new MutationObserver((mutations) => {
    if (isScraping) {
      const data = scrapeData(dataTypes, selector);
      chrome.runtime.sendMessage({ action: 'updateData', data });
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id']
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}