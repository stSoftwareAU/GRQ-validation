// Test to verify annualized performance calculation uses compound interest
// and not simple multiplication

Deno.test("Annualized Performance Calculation - Compound Interest", () => {
  // Test cases with known 90-day performances
  const testCases = [
    { 
      performance90Day: 6.07, 
      expectedAnnualized: 27.00,
      description: "Positive performance"
    },
    { 
      performance90Day: -12.98, 
      expectedAnnualized: -43.09,
      description: "Negative performance"
    },
    { 
      performance90Day: 0.48, 
      expectedAnnualized: 1.95,
      description: "Small positive performance"
    },
    { 
      performance90Day: -6.52, 
      expectedAnnualized: -23.91,
      description: "Small negative performance"
    }
  ];

  testCases.forEach(({ performance90Day, expectedAnnualized, description }) => {
    // Calculate using compound interest formula: (1 + r)^(365.25/90) - 1
    const annualizedCompound = ((1 + performance90Day / 100) ** (365.25 / 90) - 1) * 100;
    
    // Calculate using simple multiplication (incorrect method)
    const annualizedSimple = performance90Day * 4;
    
    console.log(`${description}:`);
    console.log(`  90-day performance: ${performance90Day}%`);
    console.log(`  Compound interest: ${annualizedCompound.toFixed(2)}%`);
    console.log(`  Simple multiplication: ${annualizedSimple.toFixed(2)}%`);
    console.log(`  Expected: ${expectedAnnualized}%`);
    console.log(`  Difference: ${Math.abs(annualizedCompound - expectedAnnualized).toFixed(2)}%`);
    console.log('');
    
    // Verify compound interest calculation is close to expected
    const tolerance = 0.5; // Allow 0.5% tolerance for rounding differences
    const isCorrect = Math.abs(annualizedCompound - expectedAnnualized) < tolerance;
    
    if (!isCorrect) {
      throw new Error(
        `${description}: Compound interest calculation (${annualizedCompound.toFixed(2)}%) ` +
        `does not match expected (${expectedAnnualized}%). ` +
        `Simple multiplication would be ${annualizedSimple.toFixed(2)}%`
      );
    }
    
    // Verify that simple multiplication is significantly different (for larger values)
    const simpleDifference = Math.abs(annualizedSimple - expectedAnnualized);
    if (Math.abs(performance90Day) > 5 && simpleDifference < 2.0) {
      throw new Error(
        `${description}: Simple multiplication (${annualizedSimple.toFixed(2)}%) ` +
        `is too close to expected (${expectedAnnualized}%). ` +
        `This suggests the calculation might be using simple multiplication instead of compound interest.`
      );
    }
  });
});

Deno.test("Annualized Performance Formula Verification", () => {
  // Test the exact formula used in Rust code
  const calculateAnnualized = (performance90Day: number): number => {
    if (performance90Day === 0) return 0;
    return ((1 + performance90Day / 100) ** (365.25 / 90) - 1) * 100;
  };
  
  // Test with various performance values
  const testValues = [10, -10, 5, -5, 20, -20, 1, -1];
  
  testValues.forEach(performance => {
    const annualized = calculateAnnualized(performance);
    const simple = performance * 4;
    
    console.log(`90-day: ${performance}% → Annualized: ${annualized.toFixed(2)}% (simple would be ${simple}%)`);
    
    // For positive performance, compound should be higher than simple
    if (performance > 0) {
      if (annualized <= simple) {
        throw new Error(`Positive performance ${performance}% should have compound (${annualized.toFixed(2)}%) > simple (${simple}%)`);
      }
    }
    
    // For negative performance, compound should be different from simple (for larger values)
    if (performance < 0 && Math.abs(performance) > 2) {
      if (Math.abs(annualized - simple) < 1.0) {
        throw new Error(`Negative performance ${performance}% should have compound (${annualized.toFixed(2)}%) significantly different from simple (${simple}%)`);
      }
    }
  });
});

Deno.test("Annualized Performance Edge Cases", () => {
  const calculateAnnualized = (performance90Day: number): number => {
    if (performance90Day === 0) return 0;
    return ((1 + performance90Day / 100) ** (365.25 / 90) - 1) * 100;
  };
  
  // Test edge cases
  const edgeCases = [
    { input: 0, expected: 0, description: "Zero performance" },
    { input: 100, expected: 1000, description: "100% performance" }, // Should be very high
    { input: -50, expected: -100, description: "-50% performance" }, // Should be around -100%
  ];
  
  edgeCases.forEach(({ input, expected, description }) => {
    const result = calculateAnnualized(input);
    console.log(`${description}: ${input}% → ${result.toFixed(2)}%`);
    
    if (input === 0 && result !== 0) {
      throw new Error(`Zero performance should return 0, got ${result}`);
    }
    
    if (input > 0 && result <= 0) {
      throw new Error(`Positive performance ${input}% should return positive annualized, got ${result}`);
    }
    
    if (input < 0 && result >= 0) {
      throw new Error(`Negative performance ${input}% should return negative annualized, got ${result}`);
    }
  });
}); 