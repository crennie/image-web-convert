import { expect, test, type Page } from '@playwright/test';
import { firstImage, secondImage, type ImageFixture } from './fixtures/images';

async function openConversionPage(page: Page) {
    // Session creation is unrelated to selecting local files. Keeping it offline
    // makes this smoke suite independent of the API and image conversion stack.
    await page.route('**/sessions', (route) =>
        route.fulfill({ status: 503, body: '' }),
    );
    await page.goto('/conversion');
}

async function chooseFiles(page: Page, files: ImageFixture | ImageFixture[]) {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page
        .getByRole('button', { name: 'Drag images here or click to browse' })
        .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(files);
}

test.beforeEach(async ({ page }) => {
    await openConversionPage(page);
});

test('visible upload control invokes the file chooser', async ({ page }) => {
    await chooseFiles(page, firstImage);

    await expect(
        page.getByText(firstImage.name, { exact: true }),
    ).toBeVisible();
});

test('selected file becomes pending and visible', async ({ page }) => {
    await expect(page.getByText(/files? ready to upload/i)).toHaveCount(0);

    await chooseFiles(page, firstImage);

    await expect(
        page.getByText(firstImage.name, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('1 file ready to upload.')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Start File Uploads' }),
    ).toBeEnabled();
});

test('multiple selected files remain pending', async ({ page }) => {
    await chooseFiles(page, [firstImage, secondImage]);

    await expect(
        page.getByText(firstImage.name, { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText(secondImage.name, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('2 files ready to upload.')).toBeVisible();
});

test('a pending file can be removed without removing the others', async ({
    page,
}) => {
    await chooseFiles(page, [firstImage, secondImage]);

    await page
        .getByRole('button', { name: `Remove ${firstImage.name}` })
        .click();

    await expect(page.getByText(firstImage.name, { exact: true })).toHaveCount(
        0,
    );
    await expect(
        page.getByText(secondImage.name, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('1 file ready to upload.')).toBeVisible();
});
