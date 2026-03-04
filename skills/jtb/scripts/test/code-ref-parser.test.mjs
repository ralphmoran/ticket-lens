import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFilePaths, extractMethodNames, extractClassNames, extractShas, extractSvnRevisions, extractBranches, extractNamespaces, extractCodeReferences } from '../lib/code-ref-parser.mjs';

describe('extractFilePaths', () => {
  it('extracts Unix absolute file paths from text', () => {
    const text = 'The payment validation in /app/modules/Payment/Validator.php is failing for empty carts.';
    const result = extractFilePaths(text);
    assert.deepStrictEqual(result, ['/app/modules/Payment/Validator.php']);
  });

  it('extracts relative file paths', () => {
    const text = 'Also check src/services/CartService.php and src/validators/BaseValidator.php';
    const result = extractFilePaths(text);
    assert.deepStrictEqual(result, ['src/services/CartService.php', 'src/validators/BaseValidator.php']);
  });

  it('ignores URLs as file paths', () => {
    const text = 'See https://jira.example.com/browse/PROD-1234 and http://docs.example.com/api/v2/guide.html for details. But /app/models/User.php is a real path.';
    const result = extractFilePaths(text);
    assert.deepStrictEqual(result, ['/app/models/User.php']);
  });
});

describe('extractMethodNames', () => {
  it('extracts method names with parens from text', () => {
    const text = 'The issue is in the validateCart() method. Also check processPayment() and getItems().';
    const result = extractMethodNames(text);
    assert.deepStrictEqual(result, ['validateCart', 'processPayment', 'getItems']);
  });
});

describe('extractClassNames', () => {
  it('extracts PascalCase and underscore-separated class names', () => {
    const text = 'The Payment_Validator class is broken. Also check Application_Payment_Gateway and Zend_Controller_Action base class.';
    const result = extractClassNames(text);
    assert.deepStrictEqual(result, ['Payment_Validator', 'Application_Payment_Gateway', 'Zend_Controller_Action']);
  });
});

describe('extractShas', () => {
  it('extracts 40-char and 7-char git SHAs', () => {
    const text = 'See commit abc1234 for when this was last changed. Full SHA: 9f8e7d6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e';
    const result = extractShas(text);
    assert.deepStrictEqual(result, ['9f8e7d6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e', 'abc1234']);
  });
});

describe('extractSvnRevisions', () => {
  it('extracts SVN revision numbers', () => {
    const text = 'It was changed in r4521 and reverted in r4530. See also revision r100.';
    const result = extractSvnRevisions(text);
    assert.deepStrictEqual(result, ['r4521', 'r4530', 'r100']);
  });
});

describe('extractBranches', () => {
  it('extracts branch names with ticket prefixes', () => {
    const text = 'Related branch: feature/PROD-1234-fix-payment and also feature/PROD-1100-cart-refactor';
    const result = extractBranches(text);
    assert.deepStrictEqual(result, ['feature/PROD-1234-fix-payment', 'feature/PROD-1100-cart-refactor']);
  });
});

describe('extractNamespaces', () => {
  it('extracts PHP backslash namespaces', () => {
    const text = 'Will update the Payment\\Validator namespace. Also check App\\Services\\CartService.';
    const result = extractNamespaces(text);
    assert.deepStrictEqual(result, ['Payment\\Validator', 'App\\Services\\CartService']);
  });
});

describe('edge cases', () => {
  it('handles null and empty input gracefully', () => {
    for (const fn of [extractFilePaths, extractMethodNames, extractClassNames, extractShas, extractSvnRevisions, extractBranches, extractNamespaces]) {
      assert.deepStrictEqual(fn(null), []);
      assert.deepStrictEqual(fn(undefined), []);
      assert.deepStrictEqual(fn(''), []);
    }
  });

  it('deduplicates results', () => {
    const text = 'Check /app/models/User.php and then /app/models/User.php again. Call validateCart() and validateCart() twice.';
    assert.deepStrictEqual(extractFilePaths(text), ['/app/models/User.php']);
    assert.deepStrictEqual(extractMethodNames(text), ['validateCart']);
  });
});

describe('extractCodeReferences', () => {
  it('combines all extractors into a single result object', () => {
    const text = 'Fix /app/modules/Payment/Validator.php — the validateCart() method in Payment_Validator class. Commit abc1234, revision r4521, branch feature/PROD-1234-fix-payment. Namespace Payment\\Validator.';
    const result = extractCodeReferences(text);
    assert.deepStrictEqual(result, {
      filePaths: ['/app/modules/Payment/Validator.php'],
      methods: ['validateCart'],
      classes: ['Payment_Validator'],
      shas: ['abc1234'],
      svnRevisions: ['r4521'],
      branches: ['feature/PROD-1234-fix-payment'],
      namespaces: ['Payment\\Validator'],
    });
  });
});
