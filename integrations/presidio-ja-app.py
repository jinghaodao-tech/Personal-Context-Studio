from flask import Flask, jsonify, request
from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider

configuration = {"nlp_engine_name": "spacy", "models": [{"lang_code": "ja", "model_name": "ja_ginza"}]}
provider = NlpEngineProvider(nlp_configuration=configuration)
engine = AnalyzerEngine(nlp_engine=provider.create_engine(), supported_languages=["ja"])
app = Flask(__name__)

@app.post("/analyze")
def analyze():
    payload = request.get_json(force=True) or {}
    text = payload.get("text", "")
    language = payload.get("language", "ja")
    if not isinstance(text, str) or not text:
        return jsonify({"error": "text_required"}), 400
    try:
        results = engine.analyze(text=text, language=language)
        return jsonify([{"entity_type": item.entity_type, "score": item.score, "start": item.start, "end": item.end} for item in results])
    except Exception as error:
        return jsonify({"error": "presidio_analyze_failed", "detail": str(error)}), 400
