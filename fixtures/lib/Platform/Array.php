<?php
class Platform_Array {
    public static function flatten($array) {
        $result = array();
        array_walk_recursive($array, function($val) use (&$result) {
            $result[] = $val;
        });
        return $result;
    }
}
