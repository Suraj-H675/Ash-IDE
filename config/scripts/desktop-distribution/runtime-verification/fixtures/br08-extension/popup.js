const grantButton = document.querySelector('#grant')
const status = document.querySelector('#status')

grantButton.addEventListener('click', async () => {
  grantButton.disabled = true
  try {
    const granted = await chrome.permissions.request({
      origins: ['http://127.0.0.1/*']
    })
    if (!granted) {
      status.textContent = 'BR08_PERMISSION_DENIED'
      return
    }
    await chrome.scripting.registerContentScripts([
      {
        id: 'br08-loopback-marker',
        matches: ['http://127.0.0.1/*'],
        js: ['marker.js'],
        runAt: 'document_end',
        persistAcrossSessions: true
      }
    ])
    status.textContent = 'BR08_PERMISSION_GRANTED'
  } catch (error) {
    status.textContent = `BR08_PERMISSION_ERROR: ${error instanceof Error ? error.message : String(error)}`
  }
})

const optionalButton = document.querySelector('#optional')
const optionalStatus = document.querySelector('#optional-status')
optionalButton.addEventListener('click', async () => {
  optionalButton.disabled = true
  try {
    const granted = await chrome.permissions.request({ origins: ['http://localhost/*'] })
    optionalStatus.textContent = granted ? 'BR08_OPTIONAL_GRANTED' : 'BR08_OPTIONAL_DENIED'
  } catch (error) {
    optionalStatus.textContent = `BR08_OPTIONAL_ERROR: ${error instanceof Error ? error.message : String(error)}`
  }
})
