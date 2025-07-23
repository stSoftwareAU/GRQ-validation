console.log('list.js loaded successfully! Version:', typeof VERSION !== 'undefined' ? VERSION : 'undefined');

// Set version display
document.addEventListener('DOMContentLoaded', function() {
    const versionElement = document.getElementById('version');
    if (versionElement && typeof VERSION !== 'undefined') {
        versionElement.textContent = VERSION;
    }
});

class ScoreFilesList {
    constructor() {
        this.scoreFiles = [];
        this.dataTable = null;
        this.init();
    }
    
    async init() {
        try {
            await this.loadScoreFiles();
            this.setupDataTable();
            this.setupFilters();
            this.showContent();
            this.updateSummaryStats();
        } catch (error) {
            console.error('Initialization error:', error);
            this.showError('Failed to initialize: ' + error.message);
        }
    }
    
    async loadScoreFiles() {
        try {
            console.log('Loading score files...');
            const response = await fetch('scores/index.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            this.scoreFiles = data.scores || [];
            console.log('Loaded score files:', this.scoreFiles.length);
        } catch (error) {
            console.error('Error loading score files:', error);
            throw error;
        }
    }
    
    setupDataTable() {
        try {
            // Check if DataTables is available
            if (typeof $.fn.DataTable === 'undefined') {
                throw new Error('DataTables library not loaded');
            }
            
            this.dataTable = $('#scoreFilesTable').DataTable({
                data: this.scoreFiles,
                autoWidth: false,
                scrollX: true,
                scrollCollapse: true,
                fixedHeader: true,
                columns: [
                    { 
                        data: 'date',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                const date = new Date(data);
                                return date.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                });
                            }
                            return data;
                        }
                    },
                    { 
                        data: 'file',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                return data.replace('.tsv', '');
                            }
                            return data;
                        }
                    },
                    { 
                        data: 'total_stocks',
                        render: function(data, type, row) {
                            return data || '-';
                        },
                        type: 'num'
                    },
                    { 
                        data: 'performance_90_day',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (data !== null && data !== undefined) {
                                    const color = data >= 0 ? 'performance-positive' : 'performance-negative';
                                    const sign = data >= 0 ? '+' : '';
                                    return `<span class="${color}">${sign}${data.toFixed(2)}%</span>`;
                                }
                                return '<span class="performance-neutral">-</span>';
                            }
                            return data !== null && data !== undefined ? data : -999999;
                        },
                        type: 'num'
                    },
                    { 
                        data: 'performance_annualized',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (data !== null && data !== undefined) {
                                    const color = data >= 0 ? 'performance-positive' : 'performance-negative';
                                    const sign = data >= 0 ? '+' : '';
                                    return `<span class="${color}">${sign}${data.toFixed(2)}%</span>`;
                                }
                                return '<span class="performance-neutral">-</span>';
                            }
                            return data !== null && data !== undefined ? data : -999999;
                        },
                        type: 'num'
                    },
                    { 
                        data: null,
                        orderable: false,
                        render: function(data, type, row) {
                            return `<a href="index.html?file=${encodeURIComponent(row.file)}" class="btn btn-view">
                                <i class="fas fa-eye me-1"></i>View
                            </a>`;
                        }
                    }
                ],
                order: [[0, 'asc']], // Sort by date ascending (oldest first)
                pageLength: 50,
                dom: '<"row"<"col-sm-12"B>>rtip',
                buttons: [
                    {
                        extend: 'copy',
                        text: '<i class="fas fa-copy me-1"></i>Copy',
                        className: 'dt-button'
                    },
                    {
                        extend: 'csv',
                        text: '<i class="fas fa-file-csv me-1"></i>CSV',
                        className: 'dt-button'
                    },
                    {
                        extend: 'print',
                        text: '<i class="fas fa-print me-1"></i>Print',
                        className: 'dt-button'
                    }
                ],
                language: {
                    info: 'Showing _START_ to _END_ of _TOTAL_ score files',
                    lengthMenu: 'Show _MENU_ score files per page',
                    paginate: {
                        first: 'First',
                        last: 'Last',
                        next: 'Next',
                        previous: 'Previous'
                    }
                },
                responsive: true,
                scrollX: true,
                scrollCollapse: true,
                drawCallback: () => {
                    this.updateSummaryStats();
                    // Ensure header alignment
                    this.adjustHeaderAlignment();
                }
            });
            
            console.log('DataTable initialized successfully');
        } catch (error) {
            console.error('Error setting up DataTable:', error);
            throw error;
        }
    }
    
    setupFilters() {
        try {
            // Date filters
            $('#startDate, #endDate').on('change', () => {
                this.applyFilters();
            });
            
            // Performance filter
            $('#performanceFilter').on('change', () => {
                this.applyFilters();
            });
            
            // Clear filters
            $('#clearFilters').on('click', () => {
                $('#startDate, #endDate').val('');
                $('#performanceFilter').val('');
                this.applyFilters();
            });
            
            console.log('Filters setup completed');
        } catch (error) {
            console.error('Error setting up filters:', error);
        }
    }
    
    applyFilters() {
        try {
            if (!this.dataTable) {
                console.warn('DataTable not initialized, skipping filters');
                return;
            }
            
            const startDate = $('#startDate').val();
            const endDate = $('#endDate').val();
            const performanceFilter = $('#performanceFilter').val();
            
            $.fn.dataTable.ext.search.push((settings, data, dataIndex) => {
                const date = data[0]; // Date column
                const performance90Day = data[3]; // 90-day performance column (raw data)
                
                // Date range filter
                if (startDate && new Date(date) < new Date(startDate)) {
                    return false;
                }
                if (endDate && new Date(date) > new Date(endDate)) {
                    return false;
                }
                
                // Performance filter
                if (performanceFilter) {
                    if (performance90Day === null || performance90Day === undefined || performance90Day === -999999) {
                        return false;
                    }
                    
                    switch (performanceFilter) {
                        case 'positive':
                            return performance90Day > 0;
                        case 'negative':
                            return performance90Day < 0;
                        case 'above10':
                            return performance90Day > 10;
                        case 'below-10':
                            return performance90Day < -10;
                    }
                }
                
                return true;
            });
            
            this.dataTable.draw();
            
            // Remove the filter function after drawing
            $.fn.dataTable.ext.search.pop();
        } catch (error) {
            console.error('Error applying filters:', error);
        }
    }
    
    updateSummaryStats() {
        try {
            if (!this.dataTable) {
                console.warn('DataTable not initialized, skipping summary stats');
                return;
            }
            
            const visibleData = this.dataTable.rows({ search: 'applied' }).data();
            let total90Day = 0;
            let totalAnnualized = 0;
            let positiveCount = 0;
            let valid90DayCount = 0;
            let validAnnualizedCount = 0;
            
            visibleData.each((row) => {
                const performance90Day = row.performance_90_day;
                const performanceAnnualized = row.performance_annualized;
                
                if (performance90Day !== null && performance90Day !== undefined) {
                    total90Day += performance90Day;
                    valid90DayCount++;
                    
                    if (performance90Day > 0) {
                        positiveCount++;
                    }
                }
                
                if (performanceAnnualized !== null && performanceAnnualized !== undefined) {
                    totalAnnualized += performanceAnnualized;
                    validAnnualizedCount++;
                }
            });
            
            const avg90Day = valid90DayCount > 0 ? total90Day / valid90DayCount : 0;
            const avgAnnualized = validAnnualizedCount > 0 ? totalAnnualized / validAnnualizedCount : 0;
            const totalFiles = visibleData.count();
            

            
            // Update display
            const avg90DayElement = document.getElementById('avg90Day');
            const avgAnnualizedElement = document.getElementById('avgAnnualized');
            const totalFilesElement = document.getElementById('totalFiles');
            const positiveCountElement = document.getElementById('positiveCount');
            
            if (avg90DayElement) {
                avg90DayElement.textContent = `${avg90Day >= 0 ? '+' : ''}${avg90Day.toFixed(2)}%`;
                avg90DayElement.className = `summary-stat-value ${avg90Day >= 0 ? 'text-success' : 'text-danger'}`;
            }
            
            if (avgAnnualizedElement) {
                avgAnnualizedElement.textContent = `${avgAnnualized >= 0 ? '+' : ''}${avgAnnualized.toFixed(2)}%`;
                avgAnnualizedElement.className = `summary-stat-value ${avgAnnualized >= 0 ? 'text-success' : 'text-danger'}`;
            }
            
            if (totalFilesElement) {
                totalFilesElement.textContent = totalFiles;
            }
            
            if (positiveCountElement) {
                positiveCountElement.textContent = `${positiveCount} (${valid90DayCount > 0 ? (positiveCount / valid90DayCount * 100).toFixed(1) : 0}%)`;
            }
        } catch (error) {
            console.error('Error updating summary stats:', error);
        }
    }
    
    showContent() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    }
    
    showError(message) {
        document.getElementById('loading').style.display = 'none';
        const errorDiv = document.getElementById('error');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        console.error('Error displayed to user:', message);
    }
    
    adjustHeaderAlignment() {
        try {
            if (!this.dataTable) return;
            
            // Force header and body to have the same width
            const headerTable = this.dataTable.table().header();
            const bodyTable = this.dataTable.table().body();
            
            if (headerTable && bodyTable) {
                const headerWidth = $(headerTable).width();
                const bodyWidth = $(bodyTable).width();
                
                if (headerWidth !== bodyWidth) {
                    $(headerTable).width(bodyWidth);
                    $(headerTable).find('thead').width(bodyWidth);
                }
            }
        } catch (error) {
            console.warn('Error adjusting header alignment:', error);
        }
    }
}

// Initialize when page loads and all dependencies are ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit to ensure all scripts are loaded
    setTimeout(() => {
        try {
            new ScoreFilesList();
        } catch (error) {
            console.error('Failed to initialize ScoreFilesList:', error);
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').textContent = 'Failed to initialize: ' + error.message;
            document.getElementById('error').style.display = 'block';
        }
    }, 100);
}); 