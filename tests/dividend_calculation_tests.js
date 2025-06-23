// Test case for dividend calculation within 90-day period
// Testing NYSE:WFG from 2024-11-15 score file

class DividendCalculationTest {
  constructor() {
    this.scoreDate = new Date(2024, 10, 15); // November 15, 2024
    this.ninetyDayDate = new Date(this.scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));
    this.testDividends = [
      { exDivDate: new Date('2024-12-19'), amount: 0.135 },
      { exDivDate: new Date('2024-12-27'), amount: 0.32 },
      { exDivDate: new Date('2025-03-14'), amount: 0.32 }
    ];
  }

  testDividendFiltering() {
    console.log('=== Dividend Calculation Test ===');
    console.log('Score Date:', this.scoreDate.toDateString());
    console.log('90-Day End Date:', this.ninetyDayDate.toDateString());
    console.log('');

    // Test the filtering logic
    const dividendsWithin90Days = this.testDividends.filter(dividend => 
      dividend.exDivDate <= this.ninetyDayDate
    );

    console.log('All dividends for NYSE:WFG:');
    this.testDividends.forEach((div, index) => {
      const isWithin90Days = div.exDivDate <= this.ninetyDayDate;
      console.log(`  ${index + 1}. ${div.exDivDate.toDateString()}: $${div.amount.toFixed(3)} ${isWithin90Days ? '(WITHIN 90 days)' : '(AFTER 90 days)'}`);
    });

    console.log('');
    console.log('Dividends within 90 days:', dividendsWithin90Days.length);
    console.log('Expected: 2 dividends');
    console.log('Actual:', dividendsWithin90Days.length);
    console.log('Test Result:', dividendsWithin90Days.length === 2 ? 'PASS' : 'FAIL');

    // Calculate total dividends within 90 days
    const totalDividends = dividendsWithin90Days.reduce((sum, div) => sum + div.amount, 0);
    console.log('');
    console.log('Total dividends within 90 days: $' + totalDividends.toFixed(3));
    console.log('Expected: $0.455 (0.135 + 0.32)');
    console.log('Actual: $' + totalDividends.toFixed(3));
    console.log('Test Result:', Math.abs(totalDividends - 0.455) < 0.001 ? 'PASS' : 'FAIL');

    return dividendsWithin90Days.length === 2 && Math.abs(totalDividends - 0.455) < 0.001;
  }

  testDateCalculations() {
    console.log('');
    console.log('=== Date Calculation Test ===');
    
    // Verify 90-day calculation
    const expected90DayDate = new Date(2025, 1, 13); // February 13, 2025
    const daysDiff = Math.round((this.ninetyDayDate - this.scoreDate) / (1000 * 60 * 60 * 24));
    
    console.log('Score Date:', this.scoreDate.toDateString());
    console.log('Calculated 90-Day Date:', this.ninetyDayDate.toDateString());
    console.log('Expected 90-Day Date:', expected90DayDate.toDateString());
    console.log('Days difference:', daysDiff);
    console.log('Test Result:', daysDiff === 90 ? 'PASS' : 'FAIL');

    return daysDiff === 90;
  }

  runAllTests() {
    console.log('Running dividend calculation tests...\n');
    
    const test1 = this.testDividendFiltering();
    const test2 = this.testDateCalculations();
    
    console.log('');
    console.log('=== Test Summary ===');
    console.log('Dividend Filtering Test:', test1 ? 'PASS' : 'FAIL');
    console.log('Date Calculation Test:', test2 ? 'PASS' : 'FAIL');
    console.log('Overall Result:', test1 && test2 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
    
    return test1 && test2;
  }
}

// Run the tests if this file is executed directly
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DividendCalculationTest;
} else {
  // Browser environment
  const test = new DividendCalculationTest();
  test.runAllTests();
} 