// === Wati Comfort - Sender Tag Extension ===
console.log('Wati Comfort Extension: Loaded successfully!');

let currentSender = '';
let teamMembers = ['Hugo', 'Team Member 1', 'Team Member 2', 'Support'];
let customStatuses = [];
let currentChatStatus = {}; // Store current status for each chat
let watiApiToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImNzMUBwZWdhc3VzLmhrIiwibmFtZWlkIjoiY3MxQHBlZ2FzdXMuaGsiLCJlbWFpbCI6ImNzMUBwZWdhc3VzLmhrIiwiYXV0aF90aW1lIjoiMDEvMjIvMjAyNiAwOTo1NDo1OCIsInRlbmFudF9pZCI6IjciLCJkYl9uYW1lIjoibXQtcHJvZC1UZW5hbnRzIiwiaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS93cy8yMDA4LzA2L2lkZW50aXR5L2NsYWltcy9yb2xlIjoiQURNSU5JU1RSQVRPUiIsImV4cCI6MjUzNDAyMzAwODAwLCJpc3MiOiJDbGFyZV9BSSIsImF1ZCI6IkNsYXJlX0FJIn0.u0slM3DyT3RKvdkDDC3FS7zeo3P52f7pCmhzXGBg3uA'; // Hardcoded API token

// Default statuses (removed 'Closed' as it's not needed)
const DEFAULT_STATUSES = ['Open', 'Pending', 'In Progress', 'Solved', 'On Hold'];

// Load configuration including API token
chrome.storage.sync.get(['currentSender', 'teamMembers', 'customStatuses', 'currentChatStatus', 'watiApiToken'], (result) => {
  currentSender = result.currentSender || '';
  teamMembers = result.teamMembers || ['Hugo', 'Team Member 1', 'Team Member 2', 'Support'];
  // Use hardcoded token if not set in storage
  if (result.watiApiToken) {
    watiApiToken = result.watiApiToken;
  }

  // Use stored statuses, ensuring defaults are available, without overwriting user changes
  const stored = Array.isArray(result.customStatuses) ? result.customStatuses : [];
  // Filter out "Closed" status and merge with defaults
  const filteredStored = stored.filter(s => s !== 'Closed');
  customStatuses = [...new Set([...filteredStored, ...DEFAULT_STATUSES])];

  currentChatStatus = result.currentChatStatus || {};
  
  console.log('Loaded statuses from storage:', customStatuses);
  console.log('WATI API token loaded:', watiApiToken ? 'Yes' : 'No (not configured)');
  
  // Now populate the status dropdown IMMEDIATELY
  const statusSelect = document.getElementById('wati-current-status-display');
  if (statusSelect) {
    statusSelect.innerHTML = `
      <option value="">📋 Select Status</option>
      ${customStatuses.map(status => `<option value="${status}">${status}</option>`).join('')}
    `;
    console.log('Status dropdown populated with:', customStatuses);
  } else {
    console.log('Status dropdown not found yet, will try again');
    setTimeout(() => {
      const statusSelect = document.getElementById('wati-current-status-display');
      if (statusSelect) {
        statusSelect.innerHTML = `
          <option value="">📋 Select Status</option>
          ${customStatuses.map(status => `<option value="${status}">${status}</option>`).join('')}
        `;
        console.log('Status dropdown populated (second attempt)');
      }
    }, 500);
  }
  
  addSenderDropdown();
});

// Listen for sender changes from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (request.action === 'senderChanged') {
    currentSender = request.sender;
    console.log('✓ Sender updated to:', currentSender);
    // Also update it in storage to ensure consistency
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.storage.sync.set({ currentSender: request.sender });
      }
    } catch (error) {
      // Silently ignore if extension context is invalidated
    }
    updateSenderDisplay();
    sendResponse({ success: true });
  }
  
  if (request.action === 'getCurrentCustomer') {
    console.log('getCurrentCustomer action received');
    getCurrentCustomerInfo().then(customer => {
      console.log('Sending customer response:', customer);
      sendResponse(customer);
    }).catch(error => {
      console.error('Error getting customer info:', error);
      sendResponse(null);
    });
    return true; // Keep message channel open for async response
  }
  
  return true; // Keep message channel open for async response
});

// Periodically sync currentSender from storage to catch login changes
setInterval(() => {
  try {
    // Check if extension context is still valid
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      return; // Silently skip if context is invalidated
    }
    
    chrome.storage.sync.get(['currentSender'], (result) => {
      if (chrome.runtime.lastError) {
        return; // Silently skip on error
      }
      
      if (result.currentSender !== currentSender) {
        console.log('🔄 Syncing sender from storage:', result.currentSender);
        currentSender = result.currentSender || '';
        updateSenderDisplay();
      }
    });
  } catch (error) {
    // Silently ignore all errors when extension context is invalidated
  }
}, 2000); // Check every 2 seconds

// Get current customer info from WATI UI
async function getCurrentCustomerInfo() {
  try {
    console.log('=== Attempting to get customer info ===');
    console.log('Current URL:', window.location.href);
    
    let phone = '';
    let name = '';
    
    // Use WATI's exact data-testid selectors
    const phoneElement = document.querySelector('[data-testid="teamInbox-rightSide-conversationList-phoneNumber"]');
    if (phoneElement) {
      phone = phoneElement.textContent.trim();
      console.log('✓ Found phone from testid:', phone);
    }
    
    const nameElement = document.querySelector('[data-testid="teamInbox-rightSide-conversationList-profileName"]');
    if (nameElement) {
      name = nameElement.textContent.trim();
      console.log('✓ Found name from testid:', name);
    }
    
    // Fallback: try to get from URL if not found
    if (!phone) {
      console.log('Phone not found in DOM, trying URL...');
      const urlMatch = window.location.href.match(/\/chat\/(\d+)/);
      if (urlMatch) {
        phone = '+' + urlMatch[1];
        console.log('✓ Found phone from URL:', phone);
      }
    }
    
    console.log('=== Final result ===');
    console.log('Phone:', phone || 'NOT FOUND');
    console.log('Name:', name || 'NOT FOUND');
    
    // Fetch default sales from backend
    let defaultSales = 'Not assigned';
    let defaultSalesId = null;
    let status = null;
    if (phone) {
      try {
        const response = await fetch(`https://wati-backend.wati-sales-system.workers.dev/api/chats/last-replyer?phoneNumber=${encodeURIComponent(phone)}`);
        if (response.ok) {
          const data = await response.json();
          defaultSales = data.defaultSales || 'Not assigned';
          defaultSalesId = data.defaultSalesId || null;
          status = data.status || null;
          console.log('✓ Fetched default sales:', defaultSales);
          console.log('✓ Fetched status:', status);
        }
      } catch (error) {
        console.warn('Failed to fetch chat info:', error);
      }
    }
    
    return {
      phone: phone || null,
      name: name || 'Unknown',
      defaultSales: defaultSales,
      defaultSalesId: defaultSalesId,
      status: status,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting customer info:', error);
    return { phone: null, name: null,  };
  }
}

function updateSenderDisplay() {
  const display = document.getElementById('wati-current-sender-display');
  if (display) {
    if (currentSender) {
      display.textContent = `📤 Sending as: ${currentSender}`;
      display.style.color = '#25d366';
      display.style.fontWeight = '600';
    } else {
      display.textContent = '📤 No sender selected';
      display.style.color = '#999';
    }
  }
}

function addSenderDropdown() {
  // Target the real message input (textarea from your candidates)
  const inputSelector = 'textarea';  // Candidate 1 – works in open/pending chats
  const messageInput = document.querySelector(inputSelector);

  if (!messageInput) {
    console.log('No <textarea> input found yet (possibly solved chat or not loaded)');
    return;
  }

  // Quick check if input is usable (not disabled/hidden)
  if (messageInput.disabled || messageInput.offsetParent === null) {
    console.log('Found <textarea> but it seems disabled/hidden – skipping');
    return;
  }

  // Avoid duplicates: if our wrapper is already present, do nothing
  const existingBlock = document.getElementById('wati-comfort-wrapper');
  if (existingBlock) {
    return;
  }

  console.log('Found usable message input (textarea)! Injecting UI...');

  // Sender display moved to popup only

  // Create current status dropdown selector
  const currentStatusDisplay = document.createElement('select');
  currentStatusDisplay.id = 'wati-current-status-display';
  currentStatusDisplay.style.cssText = `
    width: 100%;
    margin-bottom: 8px;
    padding: 10px;
    font-size: 14px;
    border: 2px solid #ffe0b2;
    border-radius: 6px;
    background: #fff3e0;
    color: #e65100;
    cursor: pointer;
    transition: border-color 0.2s;
    font-weight: 600;
    display: block !important;
    position: relative;
    z-index: 10000;
    min-height: 36px;
    -webkit-appearance: menulist;
    appearance: menulist;
  `;

  // Note: Options will be populated after storage loads
  currentStatusDisplay.innerHTML = `<option value="">📋 Select Status</option>`;

  currentStatusDisplay.addEventListener('change', async (e) => {
    const chatId = getChatId();
    const status = e.target.value;
    
    if (status) {
      currentChatStatus[chatId] = status;
      
      // Check if extension context is still valid
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        try {
          chrome.storage.sync.set({ currentChatStatus: currentChatStatus }, () => {
            if (chrome.runtime.lastError) {
              console.warn('Storage error:', chrome.runtime.lastError.message);
            } else {
              console.log(`Chat ${chatId} status set to: ${status}`);
            }
          });
        } catch (e) {
          console.warn('Extension context invalidated, status saved locally only');
        }
      }
      
      // Get actual phone number from customer info
      const customerInfo = await getCurrentCustomerInfo();
      if (customerInfo && customerInfo.phone) {
        // Save status to backend database
        saveStatusToBackend(customerInfo.phone, status);
      } else {
        console.warn('Could not get phone number for status save');
      }
      
      // Sync with WATI's native ticket status system
      syncStatusToWATI(status);
    }
  });

  currentStatusDisplay.addEventListener('focus', () => {
    currentStatusDisplay.style.borderColor = '#ff9800';
    currentStatusDisplay.style.boxShadow = '0 0 0 2px rgba(255, 152, 0, 0.1)';
  });

  currentStatusDisplay.addEventListener('blur', () => {
    currentStatusDisplay.style.borderColor = '#ffe0b2';
    currentStatusDisplay.style.boxShadow = 'none';
  });

  // Status management controls removed - only dropdown available

  // Status will be loaded after insertion (when getChatId() is available)

  // Create status dropdown selector - REMOVED (will use WATI's native dropdown)

  // Wrap controls to avoid duplicate stacking and keep layout stable
  const wrapper = document.createElement('div');
  wrapper.id = 'wati-comfort-wrapper';
  wrapper.style.cssText = `
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  `;

  // Only add status dropdown to wrapper
  wrapper.appendChild(currentStatusDisplay);

  // Insert wrapper above the textarea
  messageInput.parentElement.insertBefore(wrapper, messageInput);

  // Populate status dropdown options and restore current selection
  try {
    updateStatusDropdownOptions();
    updateStatusDropdown();
    const el = document.getElementById('wati-current-status-display');
    if (el) {
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      console.log('Status dropdown inserted and initialized', {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        zIndex: cs.zIndex
      });
    } else {
      console.log('Status dropdown element not found right after insertion');
    }
  } catch (e) {
    console.warn('Failed to initialize status dropdown:', e);
  }

  // Status control buttons removed

  // Function to append the sender tag to message
  function appendSenderTag() {
    console.log('=== appendSenderTag called ===');
    console.log('Current sender (cached):', currentSender);
    
    // Use cached sender for immediate synchronous operation
    const sender = currentSender;
    
    if (!sender || !sender.trim()) {
      console.warn('❌ No sender selected – sending without tag');
      return;
    }

    const tag = `\n\n— Sent by ${sender}`;
    messageInput.value += tag;
    console.log('✓ Tag appended:', tag);
    console.log('Message value after append:', messageInput.value);
  }

  // Find send button (paper plane / send icon) – common patterns in Wati/WhatsApp clones
  const sendButtonSelectors = [
    'button[aria-label*="Send" i]',
    'button[data-testid*="send" i]',
    'button[aria-label*="傳送" i]',          // Chinese variant if needed
    'button svg path[d*="M1.101 21.757"]',    // WhatsApp send icon path (common)
    'button[role="button"] svg[viewBox="0 0 24 24"]'  // Broad send icon
  ];

  let sendButton = null;
  for (const sel of sendButtonSelectors) {
    sendButton = document.querySelector(sel);
    if (sendButton) break;
  }

  if (sendButton) {
    // Remove old listeners first to avoid duplicates
    const newButton = sendButton.cloneNode(true);
    sendButton.parentNode.replaceChild(newButton, sendButton);
    newButton.addEventListener('click', () => {
      appendSenderTag();
      observer.disconnect();
    });
    console.log('Send button found and hooked!');
  } else {
    console.log('Send button not found yet – Enter key will still work');
  }

  // Enter key (without Shift) to send
  let lastMessageValue = '';
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Only append tag if message has content and is different from last processed
      const currentMessage = messageInput.value.trim();
      if (currentMessage && currentMessage !== lastMessageValue) {
        lastMessageValue = currentMessage;
        
        // Append sender tag synchronously
        appendSenderTag();
      }
      
      // Let WATI's native Enter key behavior send the message
      // Don't prevent default - this allows WATI to handle the send
    }
  });
  
  // Reset last message when input is cleared (message sent)
  messageInput.addEventListener('input', (e) => {
    if (!messageInput.value.trim()) {
      lastMessageValue = '';
    }
  });
}

// Save status to backend database
async function saveStatusToBackend(phoneNumber, status) {
  try {
    // Validate phone number
    if (!phoneNumber || phoneNumber === 'unknown' || phoneNumber === 'Unknown') {
      console.warn('Invalid phone number, skipping status save:', phoneNumber);
      return;
    }
    
    console.log('Saving status to backend:', phoneNumber, status);
    const response = await fetch('https://wati-backend.wati-sales-system.workers.dev/api/chats/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phoneNumber: phoneNumber,
        status: status
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✓ Saved status to backend:', status);
    } else {
      const errorText = await response.text();
      console.warn('❌ Failed to save status, status:', response.status, errorText);
    }
  } catch (error) {
    console.warn('❌ Failed to save status:', error);
  }
}

// Sync status to WATI via API
function syncStatusToWATI(statusName) {
  // Use hardcoded token if extension context is invalid
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    performStatusSync(watiApiToken, statusName);
    return;
  }
  
  // Load token from storage fresh to ensure we have the latest value
  try {
    chrome.storage.sync.get(['watiApiToken'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('Storage error, using hardcoded token');
        performStatusSync(watiApiToken, statusName);
        return;
      }
      
      const token = result.watiApiToken || watiApiToken;
      performStatusSync(token, statusName);
    });
  } catch (e) {
    console.warn('Extension context error, using hardcoded token');
    performStatusSync(watiApiToken, statusName);
  }
}

function performStatusSync(token, statusName) {
  if (!token) {
    console.warn('WATI API token not configured. Please set it in the extension popup.');
    return;
  }

  try {
      // Map custom statuses to WATI's native statuses
      const statusMap = {
        'Open': 'open',
        'Pending': 'pending',
        'Solved': 'solved',
        'In Progress': 'pending',
        'On Hold': 'pending',
        'Closed': 'solved'  // Map Closed to solved
      };
      
      const watiStatus = statusMap[statusName];
      if (!watiStatus) {
        console.warn(`No mapping found for status: ${statusName}`);
        return;
      }

      // Extract conversation ID from the current page
      const conversationId = getChatId();
      if (!conversationId || conversationId === 'unknown') {
        console.warn('Could not determine conversation ID - skipping WATI sync');
        return;
      }

      console.log(`Syncing status to WATI API: ${statusName} -> ${watiStatus} (conversation: ${conversationId})`);

      // Call WATI V1 API to update chat status
      const requestBody = {
        whatsappNumber: conversationId,
        TicketStatus: watiStatus  // Note: API expects capitalized "TicketStatus"
      };
      
      console.log('API Request:', {
        url: 'https://live-mt-server.wati.io/7/api/v1/updateChatStatus',
        body: requestBody
      });
      
      fetch(`https://live-mt-server.wati.io/7/api/v1/updateChatStatus`, {
        method: 'POST',
        headers: {
          'Authorization': token, // Token should already include "Bearer " prefix
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })
      .then(async response => {
        const responseText = await response.text();
        console.log('API Response:', {
          status: response.status,
          statusText: response.statusText,
          body: responseText
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status} - ${responseText}`);
        }
        
        return responseText ? JSON.parse(responseText) : {};
      })
      .then(data => {
        console.log('Status updated successfully via WATI API:', data);
      })
      .catch(error => {
        console.error('Error updating status via WATI API:', error);
        alert(`Failed to update status: ${error.message}`);
      });
    } catch (e) {
      console.error('Error syncing status to WATI:', e);
    }
}

// Run immediately + watch for chat switches / loads
const observer = new MutationObserver(() => {
  // Delay slightly to let new chat UI settle
  setTimeout(addSenderDropdown, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

// Initial run + periodic check (for slow loads)
addSenderDropdown();
setInterval(addSenderDropdown, 4000);

// Helper function to get current chat ID (WhatsApp number)
function getChatId() {
  // First try: Use WATI's data-testid selector (most reliable)
  const phoneElement = document.querySelector('[data-testid="teamInbox-rightSide-conversationList-phoneNumber"]');
  if (phoneElement) {
    const phoneText = phoneElement.textContent.trim();
    // Remove parentheses and spaces to get clean number
    const cleanNumber = phoneText.replace(/[^\d]/g, '');
    if (cleanNumber) {
      return cleanNumber;
    }
  }
  
  // Second try: Extract WhatsApp number from URL search params
  const url = new URL(window.location.href);
  const searchParams = url.searchParams.get('search');
  
  if (searchParams) {
    try {
      const searchObj = JSON.parse(decodeURIComponent(searchParams));
      if (searchObj.searchString) {
        let phoneNumber = searchObj.searchString.replace(/\D/g, ''); // Remove non-digits
        
        // Add country code if missing (assuming Hong Kong 852)
        if (phoneNumber.length === 8) {
          phoneNumber = '852' + phoneNumber;
        } else if (phoneNumber.length < 10) {
          // Try to find full number from page
          const fullNumber = extractPhoneFromPage();
          if (fullNumber) {
            return fullNumber;
          }
        }
        
        return phoneNumber;
      }
    } catch (e) {
      console.warn('Failed to parse search params:', e);
    }
  }
  
  // Fallback: try to extract from page
  const phoneFromPage = extractPhoneFromPage();
  if (phoneFromPage) {
    return phoneFromPage;
  }
  
  return 'unknown';
}

function extractPhoneFromPage() {
  // Try to find phone number in various page elements
  const selectors = [
    '[data-testid="conversation-header"]',
    '.chat-header',
    '[class*="chat-name"]',
    '[class*="contact-name"]',
    '[class*="phone"]',
    'header'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.textContent.trim();
      // Extract phone number with country code (10-15 digits)
      const phoneMatch = text.match(/\b\d{10,15}\b/);
      if (phoneMatch) {
        return phoneMatch[0];
      }
    }
  }
  
  return null;
}

// Update status dropdown when chat switches
function updateStatusDropdown() {
  const statusSelect = document.getElementById('wati-current-status-display');
  if (statusSelect) {
    const chatId = getChatId();
    const savedStatus = currentChatStatus[chatId];
    if (savedStatus) {
      statusSelect.value = savedStatus;
    } else {
      statusSelect.value = '';
    }
  }
}

// Update status dropdown options with all statuses
function updateStatusDropdownOptions() {
  const statusSelect = document.getElementById('wati-current-status-display');
  if (!statusSelect) {
    return;
  }
  
  // Rebuild options
  statusSelect.innerHTML = `
    <option value="">📋 Select Status</option>
    ${customStatuses.map(status => `<option value="${status}">${status}</option>`).join('')}
  `;
  
  console.log('Status dropdown updated with:', customStatuses);
  
  // Restore saved status
  updateStatusDropdown();
}

// Watch for chat changes and update status dropdown (cache chat ID to reduce calls)
let lastChatId = '';
setInterval(() => {
  const currentChatId = getChatId();
  if (currentChatId !== lastChatId) {
    lastChatId = currentChatId;
    updateStatusDropdown();
  }
}, 2000); // Check every 2 seconds instead of 1

console.log('Observer + interval started. Open an active chat to see the dropdown.');

// Track if we've already set up the status injection
let statusInjectionSetup = false;

// Inject custom statuses into WATI's native status dropdown
function injectCustomStatusesToWATI() {
  // Find the status dropdown container
  const statusButton = document.querySelector('[data-testid="teamInbox-content-chatHeaderV2-submitAs-dropdown"]');
  if (!statusButton) {
    return;
  }

  // Find the dropdown menu (appears when button is clicked)
  const statusDropdown = document.querySelector('.sc-iwqvcK.eHwUhm.sc-ikuOsk.bgqJSA');
  if (!statusDropdown || statusDropdown.offsetParent === null) {
    return; // Dropdown not visible
  }

  // Check if custom statuses already injected
  if (statusDropdown.querySelector('[data-custom-status], [data-add-status]')) {
    return; // Already injected
  }

  // Find an existing menu item to use as template
  const templateItem = statusDropdown.querySelector('[role="menuitem"]');
  if (!templateItem) {
    return;
  }

  // Add custom statuses
  customStatuses.forEach(status => {
    // Skip default statuses
    if (['Open', 'Pending', 'Solved'].includes(status)) {
      return;
    }

    // Check if already exists in dropdown
    const exists = Array.from(statusDropdown.querySelectorAll('[role="menuitem"]')).some(item =>
      item.querySelector('.name')?.textContent === status
    );

    if (!exists) {
      const customItem = templateItem.cloneNode(true);
      customItem.setAttribute('data-custom-status', status);
      
      const nameSpan = customItem.querySelector('.name');
      if (nameSpan) {
        nameSpan.textContent = status;
      }

      customItem.addEventListener('click', () => {
        const chatId = getChatId();
        currentChatStatus[chatId] = status;
        chrome.storage.sync.set({ currentChatStatus: currentChatStatus }, () => {
          console.log(`Chat ${chatId} status set to: ${status}`);
          const displayElement = document.getElementById('wati-current-status-display');
          if (displayElement) {
            updateCurrentStatusDisplay(displayElement);
          }
        });
      });

      statusDropdown.appendChild(customItem);
    }
  });

  // Add "Add Status" option
  if (!statusDropdown.querySelector('[data-add-status]')) {
    const addStatusItem = templateItem.cloneNode(true);
    addStatusItem.setAttribute('data-add-status', 'true');
    
    const nameSpan = addStatusItem.querySelector('.name');
    if (nameSpan) {
      nameSpan.textContent = '➕ Add Status';
    }

    addStatusItem.style.borderTop = '1px solid #eee';
    addStatusItem.style.marginTop = '8px';
    addStatusItem.style.paddingTop = '8px';

    addStatusItem.addEventListener('click', () => {
      const statusName = prompt('Enter new status name:');
      if (statusName && statusName.trim()) {
        addCustomStatus(statusName.trim());
      }
    });

    statusDropdown.appendChild(addStatusItem);
  }
}

function addCustomStatus(statusName) {
  if (!statusName) {
    return;
  }

  if (customStatuses.includes(statusName)) {
    alert('Status already exists');
    return;
  }

  if (statusName.length > 50) {
    alert('Status name too long (max 50 chars)');
    return;
  }

  customStatuses.push(statusName);
  chrome.storage.sync.set({ customStatuses: customStatuses }, () => {
    console.log('Status added:', statusName);
    updateStatusDropdownOptions(); // Update AFTER storage saves
  });
}

// Set up status injection - only once
if (!statusInjectionSetup) {
  statusInjectionSetup = true;
  
  setTimeout(() => {
    const statusButton = document.querySelector('[data-testid="teamInbox-content-chatHeaderV2-submitAs-dropdown"]');
    if (statusButton) {
      statusButton.addEventListener('click', () => {
        setTimeout(() => {
          injectCustomStatusesToWATI();
        }, 100);
      });
      console.log('Status injection listener attached');
    }
  }, 500);
}
