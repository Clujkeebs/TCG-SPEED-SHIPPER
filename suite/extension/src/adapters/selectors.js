// Every selector the adapters use lives here, so a TCGplayer page change is a one-file fix.
// These match our SYNTHETIC fixtures (test/fixtures/). They are placeholders until we have
// saved copies of the real pages (see docs/suite/LOG.md, X1 entry). Do not trust them on real pages.
export const SELECTORS_VERSION = 1;

export const PAGES = {
  orders: {
    detect: { selector: '#orders-table', pathHint: '/orders' },
    selectors: {
      table: '#orders-table',
      row: '#orders-table tr.order-row',
      orderDate: '.order-date',
      status: '.order-status',
      buyerName: '.buyer-name',
      address1: '.addr1',
      address2: '.addr2',
      city: '.city',
      state: '.state',
      postalCode: '.zip',
      country: '.country',
      item: '.items li',
      itemName: '.item-name',
      itemQty: '.item-qty',
      itemPrice: '.item-price',
      itemsTotal: '.items-total',
      shippingPaid: '.shipping-paid',
      importLink: 'a.nav-import'
    }
  },
  markShipped: {
    detect: { selector: 'form#mark-shipped', pathHint: '/ship' },
    selectors: {
      form: 'form#mark-shipped',
      row: 'form#mark-shipped .ship-row',
      tracking: 'input.tracking',
      carrier: 'select.carrier',
      submit: 'button.submit'
    }
  },
  import: {
    detect: { selector: 'form#import-csv', pathHint: '/import' },
    selectors: {
      form: 'form#import-csv',
      fileInput: 'input[type=file]#csv-file',
      submit: 'button#upload'
    }
  }
};
