import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from extract_osm_region import num, other_tag  # noqa: E402


def test_other_tags_are_read_from_the_gdal_hstore_string():
    tags = '"lanes"=>"2","surface"=>"asphalt","width"=>"7.5 m","name:en"=>"Pajajaran Road"'
    assert other_tag(tags, "lanes") == "2"
    assert other_tag(tags, "surface") == "asphalt"
    assert other_tag(tags, "maxspeed") is None
    assert other_tag(None, "lanes") is None


def test_numbers_are_parsed_leniently_and_never_invented():
    assert num("2") == 2.0
    assert num("7.5 m") == 7.5
    assert num("unknown") is None
    assert num(None) is None
