document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startScrape');
  const stopButton = document.getElementById('stopScrape');
  const toggleSelectButton = document.getElementById('toggleSelect');
  const selectorInput = document.getElementById('selector');
  const textCheckbox = document.getElementById('text');
  const imagesCheckbox = document.getElementById('images');
  const linksCheckbox = document.getElementById('links');
  const tablesCheckbox = document.getElementById('tables');
  const dataBody = document.getElementById('dataBody');
  const status = document.getElementById('status');
  const exportCSV = document.getElementById('exportCSV');
  const exportJSON = document.getElementById('exportJSON');
  const copyClipboard = document.getElementById('copyClipboard');
  const elementInfo = document.getElementById('elementInfo');
  const elementTag = document.getElementById('elementTag');
  const elementClass = document.getElementById('elementClass');
  const elementSelector = document.getElementById('elementSelector');
  const useSelectorButton = document.getElementById('useSelector');

  let isScraping = false;
  let isSelecting = false;

  toggleSelectButton.addEventListener('click', () => {
    isSelecting = !isSelecting;
    toggleSelectButton.textContent = isSelecting ? 'Stop Selecting Elements' : 'Start Selecting Elements';
    toggleSelectButton.classList.toggle('bg-purple-500', !isSelecting);
    toggleSelectButton.classList.toggle('bg-purple-700', isSelecting);
    elementInfo.classList.toggle('hidden', !isSelecting);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: isSelecting ? 'startSelecting' : 'stopSelecting'
      }, (response) => {
        if (chrome.runtime.lastError) {
          status.textContent = 'Error: Could not connect to content script.';
        }
      });
    });
  });

  useSelectorButton.addEventListener('click', () => {
    selectorInput.value = elementSelector.textContent;
    status.textContent = 'Selector applied to input field.';
  });

  startButton.addEventListener('click', () => {
    if (!isScraping) {
      isScraping = true;
      startButton.classList.add('hidden');
      stopButton.classList.remove('hidden');
      status.textContent = 'Scraping started...';

      const dataTypes = {
        text: textCheckbox.checked,
        images: imagesCheckbox.checked,
        links: linksCheckbox.checked,
        tables: tablesCheckbox.checked
      };
      const selector = selectorInput.value.trim();

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'startScraping',
          dataTypes,
          selector
        }, (response) => {
          if (chrome.runtime.lastError) {
            status.textContent = 'Error: Could not connect to content script.';
            resetButtons();
            return;
          }
          if (response && response.data) {
            displayData(response.data);
            status.textContent = response.status || 'Scraping completed.';
          } else {
            status.textContent = response?.status || 'No data found or error occurred.';
          }
          resetButtons();
        });
      });
    }
  });

  stopButton.addEventListener('click', () => {
    isScraping = false;
    startButton.classList.remove('hidden');
    stopButton.classList.add('hidden');
    status.textContent = 'Scraping stopped.';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'stopScraping' });
    });
  });

  exportCSV.addEventListener('click', () => exportData('csv'));
  exportJSON.addEventListener('click', () => exportData('json'));
  copyClipboard.addEventListener('click', () => copyToClipboard());

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'elementHovered') {
      elementTag.textContent = message.tag || 'N/A';
      elementClass.textContent = message.class || 'N/A';
      elementSelector.textContent = message.selector || 'N/A';
    }
  });

  function displayData(data) {
    dataBody.innerHTML = '';
    data.text.forEach(item => addTableRow('Text', item.content, item.selector));
    data.images.forEach(item => addTableRow('Image', item.src, item.selector));
    data.links.forEach(item => addTableRow('Link', item.href, item.selector));
    data.tables.forEach(item => addTableRow('Table', JSON.stringify(item.rows), item.selector));
  }

  function addTableRow(type, content, selector) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="border p-2">${type}</td>
      <td class="border p-2">${content}</td>
      <td class="border p-2">${selector}</td>
    `;
    dataBody.appendChild(row);
  }

  function exportData(format) {
    chrome.runtime.sendMessage({
      action: 'exportData',
      format,
      data: getTableData()
    }, (response) => {
      status.textContent = response.status;
    });
  }

  function copyToClipboard() {
    const data = JSON.stringify(getTableData(), null, 2);
    navigator.clipboard.writeText(data).then(() => {
      status.textContent = 'Data copied to clipboard.';
    }).catch(() => {
      status.textContent = 'Failed to copy data.';
    });
  }

  function getTableData() {
    const data = { text: [], images: [], links: [], tables: [] };
    const rows = dataBody.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      const type = cells[0].textContent;
      const content = cells[1].textContent;
      const selector = cells[2].textContent;
      if (type === 'Text') data.text.push({ content, selector });
      else if (type === 'Image') data.images.push({ src: content, selector });
      else if (type === 'Link') data.links.push({ href: content, selector });
      else if (type === 'Table') data.tables.push({ rows: JSON.parse(content), selector });
    });
    return data;
  }

  function resetButtons() {
    isScraping = false;
    startButton.classList.remove('hidden');
    stopButton.classList.add('hidden');
  }
});