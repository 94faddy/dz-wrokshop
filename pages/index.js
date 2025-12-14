import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const [error, setError] = useState('');
  const [workshopInfo, setWorkshopInfo] = useState(null);
  const [fetchingInfo, setFetchingInfo] = useState(false);

  const extractWorkshopId = (url) => {
    const match = url.match(/id=(\d+)/);
    return match ? match[1] : null;
  };

  const validateUrl = (url) => {
    const steamWorkshopPattern = /https?:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+/;
    return steamWorkshopPattern.test(url);
  };

  const getApiUrl = () => {
    if (typeof window !== 'undefined') {
      const currentUrl = window.location.origin;
      if (currentUrl.includes('localhost')) {
        return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      }
      return process.env.NEXT_PUBLIC_API_URL || currentUrl.replace(':3020', ':8080');
    }
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 'Unknown') return 'Unknown';
    
    // If it's already formatted (like "1.2 MB"), return as is
    if (typeof bytes === 'string' && bytes.match(/[KMGT]B/i)) {
      return bytes;
    }
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Fetch workshop info when URL changes
  useEffect(() => {
    const fetchWorkshopInfo = async () => {
      if (!url.trim() || !validateUrl(url)) {
        setWorkshopInfo(null);
        return;
      }

      const workshopId = extractWorkshopId(url);
      if (!workshopId) {
        setWorkshopInfo(null);
        return;
      }

      setFetchingInfo(true);
      try {
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/api/workshop/${workshopId}/info`, {
          credentials: 'include',
        });

        if (response.ok) {
          const info = await response.json();
          setWorkshopInfo(info);
        } else {
          setWorkshopInfo(null);
        }
      } catch (error) {
        console.error('Error fetching workshop info:', error);
        setWorkshopInfo(null);
      } finally {
        setFetchingInfo(false);
      }
    };

    const timeoutId = setTimeout(fetchWorkshopInfo, 500); // Debounce
    return () => clearTimeout(timeoutId);
  }, [url]);

  // Cleanup downloads on page unload
  useEffect(() => {
    const handleBeforeUnload = async () => {
      // Cleanup active downloads
      for (const download of downloads) {
        if (download.status !== 'completed' && download.status !== 'error') {
          try {
            const apiUrl = getApiUrl();
            await fetch(`${apiUrl}/api/cleanup/${download.id}`, {
              method: 'DELETE',
              credentials: 'include'
            });
          } catch (error) {
            console.error('Cleanup error:', error);
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [downloads]);

  const startDownload = async () => {
    if (!url.trim()) {
      setError('Please enter a valid URL');
      return;
    }

    if (!validateUrl(url)) {
      setError('Please enter a valid Steam Workshop URL');
      return;
    }

    if (workshopInfo && !workshopInfo.isValid) {
      setError('Workshop item not found or not accessible');
      return;
    }

    if (workshopInfo && !workshopInfo.isDayZ) {
      setError('This is not a DayZ workshop item');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'An error occurred');
      }

      const newDownload = {
        id: data.downloadId,
        workshopId: data.workshopId,
        url: url,
        status: 'starting',
        progress: 0,
        startTime: new Date().toISOString(),
        workshopInfo: data.workshopInfo
      };

      setDownloads(prev => [newDownload, ...prev]);
      setUrl('');
      setWorkshopInfo(null);
      
      pollDownloadStatus(data.downloadId);

    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const pollDownloadStatus = async (downloadId) => {
    const poll = async () => {
      try {
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/api/status/${downloadId}`, {
          credentials: 'include'
        });
        if (response.ok) {
          const status = await response.json();
          
          setDownloads(prev => prev.map(download => 
            download.id === downloadId 
              ? { ...download, ...status }
              : download
          ));

          if (status.status === 'completed' || status.status === 'error') {
            return;
          }

          setTimeout(poll, 2000);
        }
      } catch (error) {
        console.error('Error polling status:', error);
      }
    };

    poll();
  };

  const downloadFile = async (downloadId, workshopId) => {
    try {
      const download = downloads.find(d => d.id === downloadId);
      if (download && download.downloadUrl) {
        // Open direct download URL in new tab for faster download
        const newTab = window.open(download.downloadUrl, '_blank');
        
        // Fallback if popup blocked
        if (!newTab) {
          // Create a temporary link and click it
          const a = document.createElement('a');
          a.href = download.downloadUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        
        // Remove from downloads list after opening download
        setTimeout(() => {
          setDownloads(prev => prev.filter(d => d.id !== downloadId));
        }, 1000);
        
      } else {
        // Fallback to old method if direct URL not available
        const apiUrl = getApiUrl();
        const downloadUrl = `${apiUrl}/api/download/${downloadId}/file`;
        
        // Open in new tab
        const newTab = window.open(downloadUrl, '_blank');
        
        if (!newTab) {
          // Fallback if popup blocked
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        
        // Remove from downloads list
        setTimeout(() => {
          setDownloads(prev => prev.filter(d => d.id !== downloadId));
        }, 1000);
      }

    } catch (error) {
      setError(error.message);
    }
  };

  const copyDownloadUrl = async (downloadId) => {
    try {
      const download = downloads.find(d => d.id === downloadId);
      if (download && download.downloadUrl) {
        await navigator.clipboard.writeText(download.downloadUrl);
        // Show success feedback
        const button = document.querySelector(`[data-copy-id="${downloadId}"]`);
        if (button) {
          const originalText = button.textContent;
          button.textContent = 'Copied!';
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
        }
      }
    } catch (error) {
      console.error('Error copying URL:', error);
    }
  };

  const removeDownload = async (downloadId) => {
    try {
      // Cleanup on server
      const apiUrl = getApiUrl();
      await fetch(`${apiUrl}/api/cleanup/${downloadId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      // Remove from local state
      setDownloads(prev => prev.filter(d => d.id !== downloadId));
    }
  };

  const getStatusText = (status) => {
    const statusMap = {
      'starting': 'Initializing',
      'preparing': 'Preparing',
      'downloading': 'Downloading',
      'creating_archive': 'Creating Archive',
      'completed': 'Ready',
      'error': 'Error'
    };
    return statusMap[status] || status;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return '✓';
      case 'error': return '✗';
      default: return '⏳';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'completed': return 'status-success';
      case 'error': return 'status-error';
      default: return 'status-processing';
    }
  };

  const getProgressClass = (status) => {
    switch (status) {
      case 'completed': return 'progress-success';
      case 'error': return 'progress-error';
      default: return 'progress-processing';
    }
  };

  return (
    <div className="app-container">
      <Head>
        <title>DayZ Workshop Mods Downloader v2.0</title>
        <meta name="description" content="Professional Steam Workshop content management for DayZ - Enhanced with large file support" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Animated Background */}
      <div className="background-animation">
        <div className="floating-particle particle-1"></div>
        <div className="floating-particle particle-2"></div>
        <div className="floating-particle particle-3"></div>
        <div className="floating-particle particle-4"></div>
        <div className="floating-particle particle-5"></div>
        <div className="floating-particle particle-6"></div>
      </div>

      {/* Grid Pattern */}
      <div className="grid-background"></div>

      {/* Header */}
      <header className="main-header">
        <div className="header-content">
          <div className="header-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div className="header-text">
            <h1 className="header-title">DayZSA Mods Downloader v2.0</h1>
            <p className="header-subtitle">Enhanced large file support • Up to 10GB downloads</p>
          </div>
          <a 
            href="https://steamcommunity.com/app/221100/workshop/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="header-badge"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span>DAYZ WORKSHOP</span>
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Download Section */}
        <section className="dark-card download-card">
          <div className="card-header">
            <div className="header-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 12l2 2 4-4"/>
              </svg>
            </div>
            <h2 className="card-title">Initialize Download</h2>
            <div className="card-glow"></div>
          </div>
          
          <div className="card-content">
            <div className="input-section">
              <div className="input-group">
                <div className="input-container">
                  <input
                    type="url"
                    placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=1559212036"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="dark-input"
                    disabled={isLoading}
                  />
                  <div className="input-border-effect"></div>
                  <div className="input-icon">
                    {fetchingInfo ? (
                      <div className="loading-spinner tiny" />
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                      </svg>
                    )}
                  </div>
                </div>
                <button
                  onClick={startDownload}
                  disabled={isLoading || !url.trim() || fetchingInfo || (workshopInfo && (!workshopInfo.isValid || !workshopInfo.isDayZ))}
                  className="dark-button primary-button"
                >
                  {isLoading ? (
                    <>
                      <div className="loading-spinner" />
                      <span>Processing</span>
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7,10 12,15 17,10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      <span>Download</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Workshop Info Preview */}
            {workshopInfo && (
              <div className={`workshop-preview ${workshopInfo.isValid ? 'valid' : 'invalid'}`}>
                <div className="preview-header">
                  <div className="preview-status">
                    {workshopInfo.isValid ? (
                      <div className="status-valid">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                          <polyline points="22,4 12,14.01 9,11.01"/>
                        </svg>
                        <span>Valid Workshop Item</span>
                      </div>
                    ) : (
                      <div className="status-invalid">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="15" y1="9" x2="9" y2="15"/>
                          <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        <span>Invalid or Inaccessible</span>
                      </div>
                    )}
                  </div>
                  
                  {!workshopInfo.isDayZ && workshopInfo.isValid && (
                    <div className="game-warning">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <span>Not a DayZ Item</span>
                    </div>
                  )}
                </div>

                {workshopInfo.isValid && (
                  <div className="preview-content">
                    <div className="preview-image">
                      {workshopInfo.previewImage ? (
                        <img 
                          src={workshopInfo.previewImage} 
                          alt={workshopInfo.title}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className="image-placeholder" style={{ display: workshopInfo.previewImage ? 'none' : 'flex' }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21,15 16,10 5,21"/>
                        </svg>
                      </div>
                    </div>
                    
                    <div className="preview-details">
                      <h3 className="preview-title">{workshopInfo.title}</h3>
                      <div className="preview-meta">
                        <div className="meta-item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          <span>{workshopInfo.author}</span>
                        </div>
                        {workshopInfo.fileSize && (
                          <div className="meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14,2 14,8 20,8"/>
                            </svg>
                            <span>{workshopInfo.fileSize}</span>
                          </div>
                        )}
                        {workshopInfo.ratingsCount > 0 && (
                          <div className="meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                            </svg>
                            <span>{workshopInfo.ratingsCount} ratings</span>
                          </div>
                        )}
                      </div>
                      {workshopInfo.description && (
                        <p className="preview-description">{workshopInfo.description}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="alert error-alert">
                <div className="alert-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                </div>
                <span>{error}</span>
                <button onClick={() => setError('')} className="close-alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Downloads List */}
        {downloads.length > 0 && (
          <section className="dark-card downloads-card">
            <div className="card-header">
              <div className="header-icon-wrapper">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
              </div>
              <h2 className="card-title">Active Downloads</h2>
              <div className="download-counter">
                <span className="counter-number">{downloads.length}</span>
                <span className="counter-label">Active</span>
              </div>
              <div className="card-glow"></div>
            </div>
            
            <div className="downloads-list">
              {downloads.map((download, index) => (
                <div key={download.id} className="download-item" style={{animationDelay: `${index * 100}ms`}}>
                  <div className="download-header">
                    <div className="download-info">
                      <div className="download-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10,9 9,9 8,9"/>
                        </svg>
                      </div>
                      <div className="download-details">
                        <h3 className="download-title">
                          {download.workshopInfo?.title || `Workshop ID: ${download.workshopId}`}
                        </h3>
                        <p className="download-url">
                          {download.url.length > 45 
                            ? `${download.url.substring(0, 45)}...` 
                            : download.url
                          }
                        </p>
                        <div className="download-meta">
                          <span className="meta-item">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/>
                              <polyline points="12,6 12,12 16,14"/>
                            </svg>
                            {new Date(download.startTime).toLocaleTimeString()}
                          </span>
                          {download.workshopInfo?.author && (
                            <span className="meta-item">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                              </svg>
                              {download.workshopInfo.author}
                            </span>
                          )}
                          {download.fileSize && (
                            <span className="meta-item">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14,2 14,8 20,8"/>
                              </svg>
                              {formatFileSize(download.fileSize)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="download-actions">
                      {download.status === 'completed' ? (
                        <div className="completed-actions">
                          <button
                            onClick={() => downloadFile(download.id, download.workshopId)}
                            className="dark-button success-button"
                            title="Open download in new tab for faster downloading"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                              <polyline points="15,3 21,3 21,9"/>
                              <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                            <span>Download ZIP</span>
                          </button>
                          
                          {download.downloadUrl && (
                            <button
                              onClick={() => copyDownloadUrl(download.id)}
                              className="dark-button secondary-button"
                              data-copy-id={download.id}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                              <span>Copy URL</span>
                            </button>
                          )}
                          
                          <button
                            onClick={() => removeDownload(download.id)}
                            className="dark-button remove-button"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"/>
                              <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      ) : download.status === 'error' ? (
                        <button
                          onClick={() => removeDownload(download.id)}
                          className="dark-button danger-button"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                          <span>Remove</span>
                        </button>
                      ) : (
                        <div className="processing-status">
                          <div className="loading-spinner small" />
                          <span>Processing...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Workshop Preview in Download Item */}
                  {download.workshopInfo?.previewImage && (
                    <div className="download-preview">
                      <img 
                        src={download.workshopInfo.previewImage} 
                        alt={download.workshopInfo.title}
                        className="preview-thumbnail"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  <div className="progress-section">
                    <div className="progress-header">
                      <div className={`status-badge ${getStatusClass(download.status)}`}>
                        <span className="status-icon">{getStatusIcon(download.status)}</span>
                        <span className="status-text">{getStatusText(download.status)}</span>
                      </div>
                      <span className="progress-percentage">
                        {download.progress || 0}%
                      </span>
                    </div>
                    
                    <div className="progress-container">
                      <div className="progress-track">
                        <div 
                          className={`progress-fill ${getProgressClass(download.status)}`}
                          style={{ width: `${download.progress || 0}%` }}
                        >
                          <div className="progress-glow"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Download URL Display */}
                  {download.downloadUrl && download.status === 'completed' && (
                    <div className="download-url-section">
                      <div className="url-header">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                        <span>Direct Download URL (opens in new tab):</span>
                      </div>
                      <div className="url-display">
                        <code className="download-url-text">
                          {download.downloadUrl.length > 60 
                            ? `${download.downloadUrl.substring(0, 60)}...` 
                            : download.downloadUrl
                          }
                        </code>
                      </div>
                      <div className="download-tips">
                        <div className="tip-item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 16v-4"/>
                            <path d="M12 8h.01"/>
                          </svg>
                          <span>Click "Download ZIP" to open in new tab for faster downloads</span>
                        </div>
                        <div className="tip-item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                          </svg>
                          <span>Copy URL for use with download managers like IDM</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {download.error && (
                    <div className="error-details">
                      <div className="error-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="15" y1="9" x2="9" y2="15"/>
                          <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                      </div>
                      <div className="error-content">
                        <strong>Error Details:</strong>
                        <p>{download.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Enhanced Instructions */}
        <section className="dark-card instructions-card">
          <div className="card-header">
            <div className="header-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <circle cx="12" cy="17" r="1"/>
              </svg>
            </div>
            <h2 className="card-title">Enhanced Features & Instructions</h2>
            <div className="card-glow"></div>
          </div>
          
          <div className="card-content">
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </div>
                <h3>Large File Support</h3>
                <p>Download workshop items up to 10GB in size with optimized compression and streaming.</p>
              </div>
              
              <div className="feature-card">
                <div className="feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21,15 16,10 5,21"/>
                  </svg>
                </div>
                <h3>Workshop Preview</h3>
                <p>See workshop item details, images, file sizes, and author information before downloading.</p>
              </div>
              
              <div className="feature-card">
                <div className="feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>
                <h3>Direct Download URLs</h3>
                <p>Get permanent download links that can be shared or used with download managers.</p>
              </div>
              
              <div className="feature-card">
                <div className="feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                </div>
                <h3>Auto Cleanup</h3>
                <p>Automatic cleanup of temporary files to prevent server storage issues.</p>
              </div>
            </div>

            <div className="instructions-grid">
              <div className="instruction-item">
                <div className="step-indicator">
                  <span>01</span>
                </div>
                <div className="step-content">
                  <h3 className="step-title">Locate Workshop Item</h3>
                  <p className="step-description">Browse to the desired DayZ workshop item on Steam Community marketplace</p>
                </div>
                <div className="step-decoration"></div>
              </div>
              
              <div className="instruction-item">
                <div className="step-indicator">
                  <span>02</span>
                </div>
                <div className="step-content">
                  <h3 className="step-title">Preview & Validate</h3>
                  <p className="step-description">Paste the URL to see item preview, file size, and validation before downloading</p>
                </div>
                <div className="step-decoration"></div>
              </div>
              
              <div className="instruction-item">
                <div className="step-indicator">
                  <span>03</span>
                </div>
                <div className="step-content">
                  <h3 className="step-title">Start Download</h3>
                  <p className="step-description">Click download to begin processing with real-time progress tracking</p>
                </div>
                <div className="step-decoration"></div>
              </div>
              
              <div className="instruction-item">
                <div className="step-indicator">
                  <span>04</span>
                </div>
                <div className="step-content">
                  <h3 className="step-title">Download or Share</h3>
                  <p className="step-description">Download the ZIP file directly or copy the permanent download URL</p>
                </div>
                <div className="step-decoration"></div>
              </div>
            </div>

            <div className="warning-notice">
              <div className="notice-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div className="notice-content">
                <h4>Download Instructions</h4>
                <p>
                  This service supports files up to 10GB and only works with public DayZ workshop items. 
                  The "Download ZIP" button opens a new tab for faster downloads, especially for large files. 
                  You can also copy the direct download URL to use with download managers. 
                  The system automatically cleans up temporary files to maintain server performance.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="main-footer">
        <div className="footer-content">
          <div className="footer-info">
            <h3 className="footer-title">DayZ Workshop Downloader v2.0</h3>
            <p className="footer-subtitle">Enhanced large file support • Auto cleanup • Direct URLs • Powered by CRYTEKSOFT</p>
          </div>
          <div className="footer-stats">
            <div className="stat-card">
              <div className="stat-number">{downloads.length}</div>
              <div className="stat-label">Active Downloads</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{downloads.filter(d => d.status === 'completed').length}</div>
              <div className="stat-label">Completed</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">10GB</div>
              <div className="stat-label">Max File Size</div>
            </div>
          </div>
        </div>
      </footer>

      <style jsx>{`
        .app-container {
          min-height: 100vh;
          background: #0a0a0f;
          background-image: 
            radial-gradient(circle at 25% 25%, #1a1a2e 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, #16213e 0%, transparent 50%);
          position: relative;
          overflow-x: hidden;
          color: #e2e8f0;
        }

        .background-animation {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 1;
        }

        .floating-particle {
          position: absolute;
          background: linear-gradient(45deg, #64748b20, #475569aa);
          border-radius: 50%;
          animation: floatParticle 15s infinite ease-in-out;
        }

        .particle-1 { width: 4px; height: 4px; top: 20%; left: 10%; animation-delay: 0s; }
        .particle-2 { width: 6px; height: 6px; top: 60%; right: 15%; animation-delay: -3s; }
        .particle-3 { width: 3px; height: 3px; bottom: 30%; left: 25%; animation-delay: -6s; }
        .particle-4 { width: 5px; height: 5px; top: 15%; right: 30%; animation-delay: -9s; }
        .particle-5 { width: 4px; height: 4px; bottom: 15%; right: 10%; animation-delay: -12s; }
        .particle-6 { width: 7px; height: 7px; top: 45%; left: 5%; animation-delay: -15s; }

        @keyframes floatParticle {
          0%, 100% { transform: translateY(0px) translateX(0px) scale(1); opacity: 0.3; }
          33% { transform: translateY(-20px) translateX(10px) scale(1.1); opacity: 0.6; }
          66% { transform: translateY(20px) translateX(-10px) scale(0.9); opacity: 0.4; }
        }

        .grid-background {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-image: 
            linear-gradient(rgba(100, 116, 139, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(100, 116, 139, 0.05) 1px, transparent 1px);
          background-size: 50px 50px;
          z-index: 1;
          pointer-events: none;
        }

        .main-header {
          position: relative;
          z-index: 10;
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(71, 85, 105, 0.3);
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1rem;
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .header-icon {
          width: 70px;
          height: 70px;
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
          border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .header-text {
          flex: 1;
        }

        .header-title {
          font-size: 2.25rem;
          font-weight: 800;
          color: #f1f5f9;
          margin: 0;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
          background: linear-gradient(135deg, #f1f5f9, #cbd5e1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header-subtitle {
          font-size: 1rem;
          color: #94a3b8;
          margin: 0.5rem 0 0 0;
          font-weight: 500;
        }

        .header-badge {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white;
          padding: 0.75rem 1.5rem;
          border-radius: 25px;
          font-weight: 700;
          font-size: 0.875rem;
          box-shadow: 0 4px 20px rgba(34, 197, 94, 0.3);
          border: 1px solid rgba(34, 197, 94, 0.2);
          letter-spacing: 0.5px;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          cursor: pointer;
        }

        .header-badge:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(34, 197, 94, 0.5);
          background: linear-gradient(135deg, #16a34a, #15803d);
          border-color: rgba(34, 197, 94, 0.4);
        }

        .main-content {
          position: relative;
          z-index: 10;
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .dark-card {
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          border: 1px solid rgba(71, 85, 105, 0.3);
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          position: relative;
          animation: slideInUp 0.6s ease-out;
        }

        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(40px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .card-header {
          padding: 2rem 2rem 0 2rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          position: relative;
        }

        .header-icon-wrapper {
          width: 52px;
          height: 52px;
          background: linear-gradient(135deg, rgba(71, 85, 105, 0.4), rgba(51, 65, 85, 0.6));
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #cbd5e1;
          border: 1px solid rgba(71, 85, 105, 0.4);
          box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.2);
        }

        .card-title {
          font-size: 1.75rem;
          font-weight: 700;
          color: #f8fafc;
          margin: 0;
          flex: 1;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        }

        .card-glow {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 80%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #3b82f6, transparent);
          opacity: 0.6;
        }

        .download-counter {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: linear-gradient(135deg, #f59e0b, #d97706);
          padding: 0.75rem 1rem;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(245, 158, 11, 0.3);
          border: 1px solid rgba(245, 158, 11, 0.2);
          min-width: 80px;
        }

        .counter-number {
          font-size: 1.5rem;
          font-weight: 800;
          color: white;
          line-height: 1;
        }

        .counter-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.9);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .card-content {
          padding: 2rem;
        }

        .input-section {
          margin-bottom: 2rem;
        }

        .input-group {
          display: flex;
          gap: 1rem;
          align-items: flex-end;
        }

        .input-container {
          flex: 1;
          position: relative;
        }

        .dark-input {
          width: 100%;
          padding: 1.25rem 3rem 1.25rem 1.5rem;
          border: 2px solid rgba(71, 85, 105, 0.3);
          border-radius: 16px;
          font-size: 1rem;
          transition: all 0.3s ease;
          background: rgba(30, 41, 59, 0.6);
          color: #f1f5f9;
          backdrop-filter: blur(10px);
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }

        .dark-input::placeholder {
          color: #64748b;
        }

        .dark-input:focus {
          outline: none;
          border-color: #3b82f6;
          background: rgba(30, 41, 59, 0.8);
          box-shadow: 0 0 30px rgba(59, 130, 246, 0.2);
        }

        .dark-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .input-border-effect {
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          background: linear-gradient(45deg, #3b82f6, #8b5cf6, #06b6d4, #10b981);
          border-radius: 16px;
          z-index: -1;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .dark-input:focus + .input-border-effect {
          opacity: 0.3;
        }

        .input-icon {
          position: absolute;
          right: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          pointer-events: none;
        }

        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s linear infinite;
        }

        .loading-spinner.small {
          width: 16px;
          height: 16px;
        }

        .loading-spinner.tiny {
          width: 14px;
          height: 14px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .dark-button {
          padding: 1.25rem 2rem;
          border: none;
          border-radius: 16px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          white-space: nowrap;
          position: relative;
          overflow: hidden;
          border: 1px solid transparent;
        }

        .primary-button {
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          color: white;
          box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
          border-color: rgba(59, 130, 246, 0.2);
        }

        .primary-button:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 15px 40px rgba(59, 130, 246, 0.4);
        }

        .success-button {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white;
          box-shadow: 0 8px 25px rgba(34, 197, 94, 0.3);
          border-color: rgba(34, 197, 94, 0.2);
        }

        .success-button:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(34, 197, 94, 0.4);
        }

        .secondary-button {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: white;
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
          border-color: rgba(99, 102, 241, 0.2);
        }

        .secondary-button:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(99, 102, 241, 0.4);
        }

        .danger-button {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          box-shadow: 0 8px 25px rgba(239, 68, 68, 0.3);
          border-color: rgba(239, 68, 68, 0.2);
        }

        .danger-button:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(239, 68, 68, 0.4);
        }

        .remove-button {
          background: rgba(71, 85, 105, 0.4);
          color: #94a3b8;
          padding: 0.75rem;
          border-radius: 12px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
          border-color: rgba(71, 85, 105, 0.3);
        }

        .remove-button:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.3);
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.3);
        }

        .dark-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        /* Workshop Preview Styles */
        .workshop-preview {
          background: rgba(30, 41, 59, 0.4);
          border-radius: 16px;
          padding: 1.5rem;
          border: 1px solid rgba(71, 85, 105, 0.3);
          margin: 1.5rem 0;
          animation: slideInUp 0.3s ease-out;
        }

        .workshop-preview.invalid {
          border-color: rgba(239, 68, 68, 0.3);
          background: rgba(239, 68, 68, 0.1);
        }

        .preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .status-valid {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #4ade80;
          font-weight: 600;
          font-size: 0.875rem;
        }

        .status-invalid {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #f87171;
          font-weight: 600;
          font-size: 0.875rem;
        }

        .game-warning {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #fbbf24;
          font-weight: 600;
          font-size: 0.875rem;
          background: rgba(245, 158, 11, 0.1);
          padding: 0.5rem 1rem;
          border-radius: 20px;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .preview-content {
          display: flex;
          gap: 1.5rem;
          align-items: flex-start;
        }

        .preview-image {
          flex-shrink: 0;
          width: 120px;
          height: 90px;
          border-radius: 12px;
          overflow: hidden;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .preview-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .image-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
        }

        .preview-details {
          flex: 1;
        }

        .preview-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: #f8fafc;
          margin: 0 0 0.75rem 0;
          line-height: 1.4;
        }

        .preview-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 0.75rem;
        }

        .meta-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: #94a3b8;
        }

        .preview-description {
          font-size: 0.875rem;
          color: #cbd5e1;
          line-height: 1.5;
          margin: 0;
        }

        .alert {
          padding: 1rem 1.5rem;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.5rem;
          backdrop-filter: blur(10px);
          position: relative;
        }

        .error-alert {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fecaca;
        }

        .alert-icon {
          flex-shrink: 0;
          color: #f87171;
        }

        .close-alert {
          background: none;
          border: none;
          color: #f87171;
          cursor: pointer;
          padding: 0.25rem;
          border-radius: 4px;
          transition: all 0.2s ease;
          margin-left: auto;
        }

        .close-alert:hover {
          background: rgba(239, 68, 68, 0.2);
        }

        .downloads-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          padding: 0 2rem 2rem;
        }

        .download-item {
          background: rgba(30, 41, 59, 0.4);
          border-radius: 20px;
          padding: 2rem;
          border: 1px solid rgba(71, 85, 105, 0.3);
          transition: all 0.3s ease;
          animation: slideInLeft 0.5s ease-out;
          position: relative;
        }

        @keyframes slideInLeft {
          from {
            opacity: 0;
            transform: translateX(-30px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .download-item:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
          background: rgba(30, 41, 59, 0.6);
          border-color: rgba(71, 85, 105, 0.5);
        }

        .download-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 1.5rem;
          gap: 1rem;
        }

        .download-info {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          flex: 1;
        }

        .download-icon {
          width: 52px;
          height: 52px;
          background: linear-gradient(135deg, rgba(71, 85, 105, 0.4), rgba(51, 65, 85, 0.6));
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #cbd5e1;
          border: 1px solid rgba(71, 85, 105, 0.4);
          flex-shrink: 0;
          box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.2);
        }

        .download-details {
          flex: 1;
        }

        .download-title {
          font-weight: 600;
          color: #f8fafc;
          margin: 0 0 0.5rem 0;
          font-size: 1.125rem;
          line-height: 1.4;
        }

        .download-url {
          font-size: 0.875rem;
          color: #94a3b8;
          margin: 0 0 0.75rem 0;
          word-break: break-all;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }

        .download-meta {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .download-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .completed-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .processing-status {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: #94a3b8;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .download-preview {
          margin: 1rem 0;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .preview-thumbnail {
          width: 100%;
          height: 120px;
          object-fit: cover;
        }

        .progress-section {
          margin-top: 1.5rem;
        }

        .progress-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 500;
          font-size: 0.875rem;
          padding: 0.5rem 1rem;
          border-radius: 20px;
          border: 1px solid;
        }

        .status-processing { 
          color: #60a5fa; 
          background: rgba(96, 165, 250, 0.1);
          border-color: rgba(96, 165, 250, 0.3);
        }
        .status-success { 
          color: #4ade80; 
          background: rgba(74, 222, 128, 0.1);
          border-color: rgba(74, 222, 128, 0.3);
        }
        .status-error { 
          color: #f87171; 
          background: rgba(248, 113, 113, 0.1);
          border-color: rgba(248, 113, 113, 0.3);
        }

        .progress-percentage {
          color: #cbd5e1;
          font-weight: 700;
          font-size: 1rem;
        }

        .progress-container {
          position: relative;
        }

        .progress-track {
          width: 100%;
          height: 10px;
          background: rgba(30, 41, 59, 0.8);
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .progress-fill {
          height: 100%;
          border-radius: 10px;
          transition: width 0.8s ease;
          position: relative;
          overflow: hidden;
        }

        .progress-processing {
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
        }

        .progress-success {
          background: linear-gradient(90deg, #22c55e, #4ade80);
        }

        .progress-error {
          background: linear-gradient(90deg, #ef4444, #f87171);
        }

        .progress-glow {
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
          animation: progressGlow 2s infinite;
        }

        @keyframes progressGlow {
          0% { left: -100%; }
          100% { left: 100%; }
        }

        .download-url-section {
          margin-top: 1.5rem;
          padding: 1rem;
          background: rgba(15, 23, 42, 0.6);
          border-radius: 12px;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .url-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #cbd5e1;
          font-weight: 600;
          font-size: 0.875rem;
          margin-bottom: 0.75rem;
        }

        .url-display {
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(71, 85, 105, 0.4);
          border-radius: 8px;
          padding: 0.75rem;
        }

        .download-url-text {
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.875rem;
          color: #22d3ee;
          word-break: break-all;
        }

        .download-tips {
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(71, 85, 105, 0.3);
        }

        .tip-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .tip-item:last-child {
          margin-bottom: 0;
        }

        .tip-item svg {
          flex-shrink: 0;
          color: #60a5fa;
        }

        .error-details {
          margin-top: 1.5rem;
          padding: 1rem;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 12px;
          border: 1px solid rgba(239, 68, 68, 0.3);
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .error-icon {
          flex-shrink: 0;
          margin-top: 0.125rem;
          color: #f87171;
        }

        .error-content {
          flex: 1;
          color: #fecaca;
        }

        .error-content p {
          margin: 0.5rem 0 0 0;
          font-size: 0.875rem;
          color: #fed7d7;
        }

        /* Features Grid */
        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .feature-card {
          background: rgba(30, 41, 59, 0.4);
          border-radius: 16px;
          padding: 1.5rem;
          border: 1px solid rgba(71, 85, 105, 0.3);
          transition: all 0.3s ease;
          text-align: center;
        }

        .feature-card:hover {
          transform: translateY(-4px);
          background: rgba(30, 41, 59, 0.6);
          border-color: rgba(71, 85, 105, 0.5);
        }

        .feature-icon {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          margin: 0 auto 1rem auto;
          box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
        }

        .feature-card h3 {
          font-weight: 600;
          color: #f8fafc;
          margin: 0 0 0.75rem 0;
          font-size: 1.125rem;
        }

        .feature-card p {
          font-size: 0.875rem;
          color: #94a3b8;
          margin: 0;
          line-height: 1.6;
        }

        .instructions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .instruction-item {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 2rem;
          background: rgba(30, 41, 59, 0.4);
          border-radius: 20px;
          border: 1px solid rgba(71, 85, 105, 0.3);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .instruction-item:hover {
          transform: translateY(-4px);
          background: rgba(30, 41, 59, 0.6);
          border-color: rgba(71, 85, 105, 0.5);
        }

        .step-indicator {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          font-weight: 700;
          flex-shrink: 0;
          box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
          border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .step-content {
          flex: 1;
        }

        .step-title {
          font-weight: 600;
          color: #f8fafc;
          margin: 0 0 0.75rem 0;
          font-size: 1.125rem;
        }

        .step-description {
          font-size: 0.875rem;
          color: #94a3b8;
          margin: 0;
          line-height: 1.6;
        }

        .step-decoration {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 40px;
          height: 40px;
          background: linear-gradient(45deg, rgba(59, 130, 246, 0.1), transparent);
          border-radius: 50%;
        }

        .warning-notice {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 16px;
          padding: 2rem;
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .notice-icon {
          flex-shrink: 0;
          color: #fbbf24;
          margin-top: 0.25rem;
        }

        .notice-content h4 {
          color: #fef3c7;
          margin: 0 0 0.75rem 0;
          font-size: 1.125rem;
          font-weight: 600;
        }

        .notice-content p {
          color: #fed7aa;
          margin: 0;
          line-height: 1.6;
        }

        .main-footer {
          position: relative;
          z-index: 10;
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(20px);
          border-top: 1px solid rgba(71, 85, 105, 0.3);
          margin-top: 3rem;
        }

        .footer-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1rem;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 2rem;
        }

        .footer-info {
          flex: 1;
        }

        .footer-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #f8fafc;
          margin: 0 0 0.5rem 0;
        }

        .footer-subtitle {
          font-size: 0.875rem;
          color: #94a3b8;
          margin: 0;
        }

        .footer-stats {
          display: flex;
          gap: 1rem;
        }

        .stat-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 1.5rem 1rem;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 16px;
          min-width: 100px;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .stat-number {
          font-size: 2rem;
          font-weight: 800;
          color: #f1f5f9;
          line-height: 1;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-align: center;
          margin-top: 0.5rem;
        }

        @media (max-width: 768px) {
          .header-content {
            padding: 1.5rem 1rem;
            flex-direction: column;
            text-align: center;
            gap: 1rem;
          }
          
          .main-content {
            padding: 1rem;
          }
          
          .input-group {
            flex-direction: column;
          }
          
          .download-header {
            flex-direction: column;
            align-items: stretch;
          }
          
          .download-actions, .completed-actions {
            justify-content: flex-end;
            margin-top: 1rem;
          }
          
          .preview-content {
            flex-direction: column;
          }
          
          .preview-image {
            width: 100%;
            height: 160px;
          }
          
          .features-grid {
            grid-template-columns: 1fr;
          }
          
          .instructions-grid {
            grid-template-columns: 1fr;
          }

          .footer-content {
            flex-direction: column;
            gap: 1.5rem;
            text-align: center;
          }

          .footer-stats {
            justify-content: center;
          }
        }

        @media (max-width: 480px) {
          .card-content {
            padding: 1rem;
          }
          
          .downloads-list {
            padding: 0 1rem 1rem;
          }
          
          .download-item {
            padding: 1.5rem;
          }
          
          .instruction-item {
            flex-direction: column;
            text-align: center;
            padding: 1.5rem;
          }

          .header-title {
            font-size: 1.75rem;
          }
          
          .completed-actions {
            flex-direction: column;
            width: 100%;
          }
          
          .completed-actions .dark-button {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}