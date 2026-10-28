#[path = "../../src/wgpu_worker.rs"]
mod runtime;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub async fn execute_shader(shader: String, input: JsValue) -> Result<JsValue, JsValue> {
    let input = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&format!("invalid shader input: {error}")))?;
    let result = runtime::execute_shader(&shader, &input)
        .await
        .map_err(|error| JsValue::from_str(&error))?;
    let result: runtime::ShaderTaskResult = serde_json::from_value(result)
        .map_err(|error| JsValue::from_str(&format!("invalid shader result: {error}")))?;
    serde_wasm_bindgen::to_value(&result)
        .map_err(|error| JsValue::from_str(&format!("unable to encode shader result: {error}")))
}
