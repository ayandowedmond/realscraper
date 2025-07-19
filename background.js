chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'exportData') {
    const { format, data } = message;
    let content, mimeType, extension;

    if (format === 'csv') {
      content = dataToCSV(data);
      mimeType = 'text/csv';
      extension = 'csv';
    } else if (format === 'json') {
      content = JSON.stringify(data, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const filename = `scraped_data_${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;

    chrome.downloads.download({
      url,
      filename,
      saveAs: true
    }, () => {
      URL.revokeObjectURL(url);
      sendResponse({ status: `Data exported as ${format.toUpperCase()}.` });
    });
  }
});

function dataToCSV(data) {
  const rows = [['Type', 'Content', 'Selector']];
  data.text.forEach(item => rows.push(['Text', `"${item.content.replace(/"/g, '""')}"`, item.selector]));
  data.images.forEach(item => rows.push(['Image', item.src, item.selector]));
  data.links.forEach(item => rows.push(['Link', item.href, item.selector]));
  data.tables.forEach(item => rows.push(['Table', `"${JSON.stringify(item.rows).replace(/"/g, '""')}"`, item.selector]));
  return rows.map(row => row.join(',')).join('\n');
}