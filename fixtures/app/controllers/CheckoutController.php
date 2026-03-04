<?php
class CheckoutController extends Zend_Controller_Action {
    public function payAction() {
        $validator = new Payment_Validator();
        $cart = $this->getRequest()->getParam('cart');
        $validator->validateCart($cart);
    }
}
