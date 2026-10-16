// Import globally for testing method access
import '@testing-library/jest-dom/vitest';

// jsdom does not implement the native dialog lifecycle.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};
